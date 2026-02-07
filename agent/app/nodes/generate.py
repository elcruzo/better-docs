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
- Cover the ENTIRE codebase. Every important file/symbol should appear in at least one page.
- Group logically: getting started, core concepts, API reference, configuration, etc.
- For consumer docs: getting started, features, guides, configuration, FAQ.
- For devdocs: architecture, API reference (grouped by module), types, auth, errors.
- page_id must be a short slug (e.g. "getting-started", "api-users").
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


def _get_symbols_for_page(page_plan: dict, structure: list[dict]) -> str:
    """Extract full symbol details (signatures, docstrings, params, types) for files relevant to a page."""
    source_files = set(page_plan.get("source_files", []))
    source_symbols = set(page_plan.get("source_symbols", []))

    details = []
    for f in structure:
        path = f.get("path", "")
        if path not in source_files:
            continue
        symbols = f.get("symbols", [])
        file_lines = [f"# {path}"]
        for s in symbols:
            name = s.get("name", "")
            kind = s.get("kind", "")
            sig = s.get("sig", "")
            doc = s.get("doc", "")
            ret = s.get("ret", "")
            vis = s.get("vis", "")
            parent = s.get("parent", "")
            params = s.get("params", "")
            decos = s.get("decos", "")
            entry = f"  {kind} {name}"
            if parent:
                entry += f" (in {parent})"
            if vis:
                entry += f" [{vis}]"
            if sig:
                entry += f"\n    signature: {sig}"
            if decos:
                entry += f"\n    decorators: {decos}"
            if params:
                entry += f"\n    params: {params}"
            if ret:
                entry += f"\n    returns: {ret}"
            if doc:
                entry += f"\n    docstring: {doc}"
            file_lines.append(entry)
        details.append("\n".join(file_lines))

    # Also include any explicitly named symbols from files we didn't match
    if source_symbols:
        for f in structure:
            path = f.get("path", "")
            if path in source_files:
                continue
            for s in f.get("symbols", []):
                if s.get("name", "") in source_symbols:
                    sig = s.get("sig", "")
                    doc = s.get("doc", "")
                    entry = f"# {path}\n  {s.get('kind','')} {s['name']}"
                    if sig:
                        entry += f"\n    signature: {sig}"
                    if doc:
                        entry += f"\n    docstring: {doc}"
                    details.append(entry)

    return "\n\n".join(details) if details else "No specific symbols found."


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


async def _generate_page(page_id: str, page_plan: dict, structure: list[dict], doc_type: str, repo_name: str, readme: str) -> tuple[str, dict]:
    """Phase 2: generate one page using its relevant symbols."""
    symbols_context = _get_symbols_for_page(page_plan, structure)
    user_msg = f"""Generate the "{page_plan.get('title', page_id)}" page for {doc_type} docs of "{repo_name}".

Page purpose: {page_plan.get('description', '')}

Relevant code:
{symbols_context}

README excerpt (for context):
{readme[:1500] if readme else "N/A"}

Return the page JSON."""

    response = await llm.ainvoke([SystemMessage(content=PAGE_PROMPT), HumanMessage(content=user_msg)])
    return page_id, _parse_json(response.content)


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
    for result in results:
        if isinstance(result, Exception):
            continue
        page_id, page_data = result
        pages[page_id] = page_data

    if on_progress:
        on_progress("generate", 99, "Assembling final documentation...")

    return {
        "doc_type": plan.get("doc_type", doc_type),
        "title": plan.get("title", repo_name),
        "description": plan.get("description", ""),
        "navigation": plan.get("navigation", []),
        "pages": pages,
    }
