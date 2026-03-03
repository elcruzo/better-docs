import json, asyncio, logging, time
from langchain_core.messages import SystemMessage, HumanMessage
from app.llm import get_llm

log = logging.getLogger("agent")

ROUTER_PROMPT = """You are a documentation routing agent. Given a table of contents with page summaries and a user's refinement request, identify which pages need to be modified.

Return ONLY a JSON object:
{"page_ids": ["page-id-1", "page-id-2"], "include_meta": true/false, "strategy": "brief description of what to change"}

- "page_ids": array of page IDs that need content changes
- "include_meta": true if the overall title/description should change
- "strategy": one sentence describing the refinement approach

If the request is vague or applies broadly (e.g. "make it better"), include all page IDs."""

REFINE_PAGE_PROMPT = """You are a documentation writer agent for "better-docs". You receive ONE documentation page as JSON and a refinement instruction.

Apply the refinement to this page and return the COMPLETE updated page JSON (same schema as input).

Rules:
- Preserve sections the instruction doesn't mention.
- No emojis. Clean professional language.
- Include real code examples where relevant.
- Return ONLY valid JSON, no markdown fences."""

REFINE_META_PROMPT = """You are a documentation metadata agent. Update the title and description based on the instruction.

Return ONLY a JSON object: {"title": "...", "description": "..."}"""

VALIDATE_PROMPT = """You are a documentation QA agent. You receive a documentation page JSON that was just refined. Check for:
1. Valid JSON structure with "title", "description", "sections" array
2. Each section has a valid "type" field
3. No placeholder text like "TODO" or "lorem ipsum"
4. Professional language, no emojis

If the page is valid, return: {"valid": true}
If invalid, return: {"valid": false, "issues": ["issue1", "issue2"]}

Return ONLY JSON."""


async def refine_docs(current_docs: dict, prompt: str, repo_name: str) -> dict:
    t0 = time.time()
    llm = get_llm()
    pages = current_docs.get("pages", {})
    navigation = current_docs.get("navigation", [])

    toc_lines = []
    for group in navigation:
        toc_lines.append(f"## {group.get('group', '')}")
        for page_id in group.get("pages", []):
            page = pages.get(page_id, {})
            desc = page.get("description", "")
            n_sections = len(page.get("sections", []))
            toc_lines.append(f"  - {page_id}: {page.get('title', page_id)} ({n_sections} sections) — {desc}")
    toc = "\n".join(toc_lines)

    # --- Agent 1: Router — decide which pages to touch ---
    log.info("[refine/router] Identifying target pages for: %s", prompt[:80])
    router_msg = f"""Documentation for "{repo_name}":

{toc}

User request: {prompt}"""

    try:
        router_resp = await asyncio.wait_for(
            llm.ainvoke([SystemMessage(content=ROUTER_PROMPT), HumanMessage(content=router_msg)]),
            timeout=30,
        )
        plan = _parse_json(router_resp.content)
        target_ids = plan.get("page_ids", list(pages.keys()))
        include_meta = plan.get("include_meta", False)
        strategy = plan.get("strategy", prompt)
        if not isinstance(target_ids, list):
            target_ids = list(pages.keys())
        log.info("[refine/router] Strategy: %s | Targets: %s | Meta: %s", strategy, target_ids, include_meta)
    except Exception as e:
        log.warning("[refine/router] Failed, refining all pages: %s", e)
        target_ids = list(pages.keys())
        include_meta = False
        strategy = prompt

    updated_docs = {**current_docs, "pages": {**pages}}

    # --- Agent 2: Meta agent (if needed, runs concurrently with page agents) ---
    async def _refine_meta() -> None:
        if not include_meta:
            return
        try:
            meta_msg = f"""Current title: {current_docs.get('title', '')}
Current description: {current_docs.get('description', '')}

Instruction: {strategy}"""
            resp = await asyncio.wait_for(
                llm.ainvoke([SystemMessage(content=REFINE_META_PROMPT), HumanMessage(content=meta_msg)]),
                timeout=30,
            )
            meta = _parse_json(resp.content)
            if meta.get("title"):
                updated_docs["title"] = meta["title"]
            if meta.get("description"):
                updated_docs["description"] = meta["description"]
            log.info("[refine/meta] Updated title/description")
        except Exception as e:
            log.error("[refine/meta] Failed: %s", e)

    # --- Agent 3 (x N): Page writer agents — one per target page ---
    async def _refine_one_page(page_id: str) -> tuple[str, dict | None]:
        page_data = pages.get(page_id)
        if not page_data:
            return page_id, None

        page_json = json.dumps(page_data, indent=2)
        if len(page_json) > 15000:
            page_json = json.dumps(page_data)[:15000]

        user_msg = f"""Page "{page_id}" from "{repo_name}" docs:
{page_json}

Instruction: {strategy}

Return the updated page JSON."""

        resp = await asyncio.wait_for(
            llm.ainvoke([SystemMessage(content=REFINE_PAGE_PROMPT), HumanMessage(content=user_msg)]),
            timeout=90,
        )
        refined = _parse_json(resp.content)
        return page_id, refined

    # --- Agent 4: Validator agent — quick check on each refined page ---
    async def _validate_page(page_id: str, page_data: dict) -> tuple[str, dict, bool]:
        try:
            check_json = json.dumps(page_data)
            if len(check_json) > 8000:
                check_json = check_json[:8000]
            resp = await asyncio.wait_for(
                llm.ainvoke([SystemMessage(content=VALIDATE_PROMPT), HumanMessage(content=check_json)]),
                timeout=20,
            )
            result = _parse_json(resp.content)
            valid = result.get("valid", True)
            if not valid:
                log.warning("[refine/validate] Page '%s' has issues: %s", page_id, result.get("issues"))
            return page_id, page_data, valid
        except Exception:
            return page_id, page_data, True

    sem = asyncio.Semaphore(6)

    async def _refine_and_validate(page_id: str) -> tuple[str, dict | None]:
        async with sem:
            try:
                pid, refined = await _refine_one_page(page_id)
                if not refined:
                    return pid, None
                _, validated_data, is_valid = await _validate_page(pid, refined)
                if is_valid:
                    return pid, validated_data
                # Validation failed — keep original
                log.warning("[refine/validate] Keeping original page '%s' due to validation failure", pid)
                return pid, pages.get(pid)
            except Exception as e:
                log.error("[refine/writer] Page '%s' failed: %s", page_id, e)
                return page_id, None

    # --- Run all agents concurrently ---
    page_ids_to_refine = [pid for pid in target_ids if pid in pages]
    all_tasks = [_refine_meta()]
    all_tasks.extend([_refine_and_validate(pid) for pid in page_ids_to_refine])

    log.info("[refine] Launching %d page agents + meta agent", len(page_ids_to_refine))
    results = await asyncio.gather(*all_tasks, return_exceptions=True)

    # First result is meta (returns None), rest are page results
    for result in results[1:]:
        if isinstance(result, Exception):
            log.error("[refine] Agent failed: %s", result)
            continue
        page_id, page_data = result
        if page_data:
            updated_docs["pages"][page_id] = page_data

    log.info("[refine] Done in %.1fs — refined %d pages", time.time() - t0, len(page_ids_to_refine))
    return updated_docs


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        raise
