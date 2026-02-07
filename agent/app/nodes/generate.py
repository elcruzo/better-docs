import json, asyncio
from typing import Callable, Optional
from langchain_core.messages import SystemMessage, HumanMessage
from app.llm import get_llm

llm = get_llm()

# --- Phase 1: Plan ---
# Send full file tree + symbol names (compact). LLM returns a doc outline
# specifying which pages to create and which files/symbols each page covers.

PLAN_PROMPT = """You are a documentation architect. Given a complete codebase structure, produce a documentation plan as JSON.

You receive every file and symbol in the repo. Your job: decide what documentation pages to create, and map each page to the specific files and symbols it should cover.

Return JSON matching this schema:
{
  "title": "Project Name",
  "description": "One-line project description",
  "navigation": [
    {"group": "Group Name", "pages": ["page_id_1", "page_id_2"]}
  ],
  "pages": {
    "page_id": {
      "title": "Page Title",
      "description": "What this page covers",
      "source_files": ["path/to/file1.py", "path/to/file2.py"],
      "source_symbols": ["ClassName", "function_name"]
    }
  }
}

Rules:
- Create between 6 and 15 pages MAXIMUM. Combine related topics into single pages rather than making many small ones.
- Cover the ENTIRE codebase. Every important file/symbol should appear in at least one page.
- Group logically: getting started, core concepts, API reference, configuration, etc.
- For consumer docs: getting started, features, guides, configuration, FAQ.
- For devdocs: architecture, API reference (grouped by module), types, auth, errors.
- For large codebases, merge related API modules into fewer, richer pages instead of one page per module.
- page_id must be a lowercase slug using only a-z, 0-9, and hyphens (e.g. "getting-started", "api-users"). The EXACT same slug must appear in both "navigation" and "pages".
- No emojis. Return ONLY valid JSON."""


def _build_file_tree(structure: list[dict]) -> str:
    """Full file tree with all symbol names -- compact but complete, zero truncation."""
    lines = []
    for f in structure:
        path = f.get("path", "")
        lang = f.get("language", "")
        symbols = f.get("symbols", [])
        if not symbols:
            lines.append(f"{path} ({lang})")
        else:
            sym_parts = []
            for s in symbols:
                kind = s.get("kind", "")
                name = s.get("name", "")
                sym_parts.append(f"{kind}:{name}")
            lines.append(f"{path} ({lang}) [{', '.join(sym_parts)}]")
    return "\n".join(lines)


_SYMBOLS_BUDGET = 12000  # max chars for per-page symbol context


def _format_symbol(s: dict) -> str:
    """Format a single symbol into a readable text block."""
    name = s.get("name", "")
    kind = s.get("kind", "")
    entry = f"  {kind} {name}"
    if s.get("parent"):
        entry += f" (in {s['parent']})"
    if s.get("vis"):
        entry += f" [{s['vis']}]"
    if s.get("sig"):
        entry += f"\n    signature: {s['sig']}"
    if s.get("decos"):
        entry += f"\n    decorators: {s['decos']}"
    if s.get("params"):
        entry += f"\n    params: {s['params']}"
    if s.get("ret"):
        entry += f"\n    returns: {s['ret']}"
    if s.get("doc"):
        entry += f"\n    docstring: {s['doc']}"
    return entry


def _format_file_block(path: str, symbols: list[dict]) -> str:
    """Format all symbols from one file into a complete block."""
    lines = [f"# {path}"]
    for s in symbols:
        lines.append(_format_symbol(s))
    return "\n".join(lines)


def _get_symbols_for_page(page_plan: dict, structure: list[dict], budget: int = _SYMBOLS_BUDGET) -> str:
    """Extract full symbol details for files relevant to a page, staying within a character budget.

    Prioritises explicitly-named symbols, then fills remaining budget with
    matched source files. Each included file block is always complete -- we
    never slice mid-symbol.
    """
    source_files = set(page_plan.get("source_files", []))
    source_symbols = set(page_plan.get("source_symbols", []))

    # --- 1. Build all candidate blocks, split into priority / normal ---
    priority_blocks: list[str] = []   # explicitly named symbols from non-source files
    normal_blocks: list[str] = []     # full file blocks from source_files

    # Source-file blocks (bulk of the context)
    for f in structure:
        path = f.get("path", "")
        if path not in source_files:
            continue
        block = _format_file_block(path, f.get("symbols", []))
        normal_blocks.append(block)

    # Explicitly-named symbols from OTHER files (higher priority -- user asked for these)
    if source_symbols:
        for f in structure:
            path = f.get("path", "")
            if path in source_files:
                continue
            for s in f.get("symbols", []):
                if s.get("name", "") in source_symbols:
                    block = f"# {path}\n{_format_symbol(s)}"
                    priority_blocks.append(block)

    # --- 2. Fill up to budget, priority blocks first ---
    selected: list[str] = []
    used = 0
    omitted = 0

    for block in priority_blocks + normal_blocks:
        cost = len(block) + 2  # +2 for the "\n\n" separator
        if used + cost > budget and selected:
            omitted += 1
            continue
        selected.append(block)
        used += cost

    if omitted:
        selected.append(f"... ({omitted} more file(s) omitted to stay concise)")

    return "\n\n".join(selected) if selected else "No specific symbols found."


# --- Phase 2: Generate per page ---

PAGE_PROMPT = """You are a documentation writer for "better-docs". Generate content for ONE documentation page as structured JSON.

Return JSON matching this schema:
{
  "title": "Page Title",
  "description": "Page description",
  "sections": [
    {"type": "paragraph", "content": "Text content"},
    {"type": "heading", "content": "Heading text", "level": 2},
    {"type": "codeBlock", "language": "python", "content": "code here"},
    {"type": "endpoint", "method": "GET", "path": "/users", "description": "...", "params": [{"name": "id", "type": "string", "description": "..."}], "response": "..."},
    {"type": "cardGroup", "cards": [{"title": "...", "description": "...", "icon": "code"}]},
    {"type": "table", "content": "markdown table"},
    {"type": "list", "items": ["item1", "item2"]}
  ]
}

Rules:
- Write clear, human-readable explanations based on the actual code.
- Include real code examples derived from the signatures and docstrings.
- No emojis. Professional, clean language.
- No placeholder text. Everything should be real, derived from the code.
- Return ONLY valid JSON."""


async def _plan_docs(structure: list[dict], doc_type: str, repo_name: str, readme: str) -> dict:
    """Phase 1: get a documentation plan from the full file tree."""
    file_tree = _build_file_tree(structure)
    user_msg = f"""Plan {doc_type} documentation for "{repo_name}" ({len(structure)} files).

README:
{readme[:4000] if readme else "No README."}

Complete file tree with symbols:
{file_tree}

Return the documentation plan as JSON."""

    response = await llm.ainvoke([SystemMessage(content=PLAN_PROMPT), HumanMessage(content=user_msg)])
    return _parse_json(response.content)


MAX_PAGE_RETRIES = 2  # retry up to 2 extra times on failure


async def _generate_page(page_id: str, page_plan: dict, structure: list[dict], doc_type: str, repo_name: str, readme: str) -> tuple[str, dict]:
    """Phase 2: generate one page using its relevant symbols, with retry logic."""
    symbols_context = _get_symbols_for_page(page_plan, structure)
    user_msg = f"""Generate the "{page_plan.get('title', page_id)}" page for {doc_type} docs of "{repo_name}".

Page purpose: {page_plan.get('description', '')}

Relevant code:
{symbols_context}

README excerpt (for context):
{readme[:1500] if readme else "N/A"}

Return the page JSON."""

    last_error = None
    for attempt in range(1 + MAX_PAGE_RETRIES):
        try:
            response = await llm.ainvoke([SystemMessage(content=PAGE_PROMPT), HumanMessage(content=user_msg)])
            return page_id, _parse_json(response.content)
        except Exception as e:
            last_error = e
            if attempt < MAX_PAGE_RETRIES:
                await asyncio.sleep(1 * (attempt + 1))  # brief back-off: 1s, 2s
    raise last_error


def _parse_json(text: str) -> dict:
    """Robustly extract JSON from LLM output."""
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


# --- Main entry point ---

ProgressCallback = Optional[Callable[[str, int, str], None]]


async def generate_docs(
    structure: list[dict],
    doc_type: str,
    repo_name: str,
    readme_content: str = "",
    on_progress: ProgressCallback = None,
) -> dict:
    """Generate full documentation. on_progress(step, percent, message) is called for SSE streaming."""

    # Phase 1: plan
    if on_progress:
        on_progress("generate", 40, f"Planning documentation structure...")
    plan = await _plan_docs(structure, doc_type, repo_name, readme_content)

    pages_plan = plan.get("pages", {})
    if not pages_plan:
        return plan  # fallback: plan itself might be complete docs

    # Safety cap: if LLM planned too many pages, trim to 15
    MAX_PAGES = 15
    if len(pages_plan) > MAX_PAGES:
        # Keep only the first MAX_PAGES entries (they're ordered by the LLM's priority)
        trimmed_ids = list(pages_plan.keys())[:MAX_PAGES]
        pages_plan = {k: pages_plan[k] for k in trimmed_ids}
        # Also trim navigation to only reference kept pages
        nav = plan.get("navigation", [])
        for group in nav:
            group["pages"] = [p for p in group.get("pages", []) if p in pages_plan]
        plan["navigation"] = [g for g in nav if g.get("pages")]
        plan["pages"] = pages_plan

    total_pages = len(pages_plan)
    if on_progress:
        on_progress("generate", 42, f"Generating {total_pages} pages...")

    # Phase 2: generate pages with concurrency limit (Semaphore)
    # Cap at 5 to avoid Bedrock connection pool overflow (pool=10)
    sem = asyncio.Semaphore(5)
    completed = {"count": 0}

    async def _generate_page_limited(page_id: str, page_plan: dict) -> tuple[str, dict]:
        async with sem:
            result = await _generate_page(page_id, page_plan, structure, doc_type, repo_name, readme_content)
            completed["count"] += 1
            if on_progress:
                pct = 42 + int((completed["count"] / total_pages) * 55)  # 42% -> 97%
                on_progress("generate", pct, f"Generated page {completed['count']}/{total_pages}: {page_plan.get('title', page_id)}")
            return result

    tasks = [
        _generate_page_limited(page_id, page_plan)
        for page_id, page_plan in pages_plan.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Assemble final docs
    pages = {}
    failed_count = 0
    for result in results:
        if isinstance(result, Exception):
            failed_count += 1
            continue
        page_id, page_data = result
        pages[page_id] = page_data

    if on_progress:
        msg = f"Assembling final documentation... ({len(pages)}/{total_pages} pages succeeded"
        if failed_count:
            msg += f", {failed_count} failed after retries"
        msg += ")"
        on_progress("generate", 99, msg)

    return {
        "doc_type": plan.get("doc_type", doc_type),
        "title": plan.get("title", repo_name),
        "description": plan.get("description", ""),
        "navigation": plan.get("navigation", []),
        "pages": pages,
    }
