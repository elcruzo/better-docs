import asyncio, logging
from typing import Callable, Optional
from langchain_core.messages import SystemMessage, HumanMessage
from app.llm import get_llm
from app.models import DocPlan, DocPage

log = logging.getLogger("agent")

llm = get_llm()
plan_llm = llm.with_structured_output(DocPlan)
page_llm = llm.with_structured_output(DocPage)

PLAN_PROMPT = """You are a documentation architect. Given a complete codebase structure, produce a documentation plan.

You receive every file and symbol in the repo. Decide what documentation pages to create, and map each page to the specific files and symbols it should cover.

Rules:
- Create between 4 and 9 pages MAXIMUM. Combine related topics into single pages rather than making many small ones.
- Cover the ENTIRE codebase. Every important file/symbol should appear in at least one page.
- Group logically: getting started, core concepts, API reference, configuration, etc.
- For consumer docs: getting started, features, guides, configuration, FAQ.
- For devdocs: architecture, API reference (grouped by module), types, auth, errors.
- For large codebases, merge related API modules into fewer, richer pages instead of one page per module.
- page_id must be a lowercase slug using only a-z, 0-9, and hyphens (e.g. "getting-started", "api-users"). The EXACT same slug must appear in both navigation and pages.
- No emojis."""

PAGE_PROMPT = """You are a documentation writer for "better-docs". Generate content for ONE documentation page.

Rules:
- Write clear, human-readable explanations based on the actual code.
- Include real code examples derived from the signatures and docstrings.
- No emojis. Professional, clean language.
- No placeholder text. Everything should be real, derived from the code.
- Use a mix of section types: headings, paragraphs, code blocks, tables, lists, endpoints, card groups."""

PIPELINE_MAX_TIMEOUT = 600  # 10 min -- individual calls have no timeout; the pipeline enforces the cap


def _build_file_tree(structure: list[dict]) -> str:
    lines = []
    for f in structure:
        path = f.get("path", "")
        lang = f.get("language", "")
        symbols = f.get("symbols", [])
        if not symbols:
            lines.append(f"{path} ({lang})")
        else:
            sym_parts = [f"{s.get('kind', '')}:{s.get('name', '')}" for s in symbols]
            lines.append(f"{path} ({lang}) [{', '.join(sym_parts)}]")
    return "\n".join(lines)


_SYMBOLS_BUDGET = 12000


def _format_symbol(s: dict) -> str:
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
    lines = [f"# {path}"]
    for s in symbols:
        lines.append(_format_symbol(s))
    return "\n".join(lines)


def _get_symbols_for_page(page_plan: dict, structure: list[dict], budget: int = _SYMBOLS_BUDGET) -> str:
    """Extract full symbol details for files relevant to a page, within a character budget."""
    source_files = set(page_plan.get("source_files", []))
    source_symbols = set(page_plan.get("source_symbols", []))

    priority_blocks: list[str] = []
    normal_blocks: list[str] = []

    for f in structure:
        path = f.get("path", "")
        if path not in source_files:
            continue
        normal_blocks.append(_format_file_block(path, f.get("symbols", [])))

    if source_symbols:
        for f in structure:
            path = f.get("path", "")
            if path in source_files:
                continue
            for s in f.get("symbols", []):
                if s.get("name", "") in source_symbols:
                    priority_blocks.append(f"# {path}\n{_format_symbol(s)}")

    selected: list[str] = []
    used = 0
    omitted = 0

    for block in priority_blocks + normal_blocks:
        cost = len(block) + 2
        if used + cost > budget and selected:
            omitted += 1
            continue
        selected.append(block)
        used += cost

    if omitted:
        selected.append(f"... ({omitted} more file(s) omitted to stay concise)")

    return "\n\n".join(selected) if selected else "No specific symbols found."


async def _plan_docs(structure: list[dict], doc_type: str, repo_name: str, readme: str) -> DocPlan:
    file_tree = _build_file_tree(structure)
    user_msg = f"""Plan {doc_type} documentation for "{repo_name}" ({len(structure)} files).

README:
{readme[:4000] if readme else "No README."}

Complete file tree with symbols:
{file_tree}"""

    return await plan_llm.ainvoke([SystemMessage(content=PLAN_PROMPT), HumanMessage(content=user_msg)])



async def _generate_page(page_id: str, page_plan: dict, structure: list[dict], doc_type: str, repo_name: str, readme: str) -> tuple[str, dict]:
    symbols_context = _get_symbols_for_page(page_plan, structure)
    user_msg = f"""Generate the "{page_plan.get('title', page_id)}" page for {doc_type} docs of "{repo_name}".

Page purpose: {page_plan.get('description', '')}

Relevant code:
{symbols_context}

README excerpt (for context):
{readme[:1500] if readme else "N/A"}"""

    result: DocPage = await page_llm.ainvoke([SystemMessage(content=PAGE_PROMPT), HumanMessage(content=user_msg)])
    return page_id, result.model_dump(exclude_none=True)


# --- Main entry point ---

ProgressCallback = Optional[Callable[[str, int, str], None]]
PageCallback = Optional[Callable[[str, dict], None]]


async def generate_docs(
    structure: list[dict],
    doc_type: str,
    repo_name: str,
    readme_content: str = "",
    on_progress: ProgressCallback = None,
    on_page: PageCallback = None,
) -> dict:
    """Generate full documentation with structured LLM outputs."""

    if on_progress:
        on_progress("generate", 40, "Planning documentation structure...")
    plan = await _plan_docs(structure, doc_type, repo_name, readme_content)

    pages_plan = plan.pages
    if not pages_plan:
        return plan.model_dump()

    MAX_PAGES = 9
    if len(pages_plan) > MAX_PAGES:
        trimmed_ids = list(pages_plan.keys())[:MAX_PAGES]
        pages_plan = {k: pages_plan[k] for k in trimmed_ids}
        plan.pages = pages_plan
        for group in plan.navigation:
            group.pages = [p for p in group.pages if p in pages_plan]
        plan.navigation = [g for g in plan.navigation if g.pages]

    total_pages = len(pages_plan)
    if on_progress:
        on_progress("generate", 42, f"Generating {total_pages} pages...")

    if on_page:
        on_page("__plan__", {
            "doc_type": doc_type,
            "title": plan.title,
            "description": plan.description,
            "navigation": [g.model_dump() for g in plan.navigation],
        })

    sem = asyncio.Semaphore(5)
    completed = {"count": 0}

    async def _generate_page_limited(page_id: str, pp: dict) -> tuple[str, dict]:
        async with sem:
            try:
                result = await _generate_page(page_id, pp, structure, doc_type, repo_name, readme_content)
            except Exception as e:
                log.error("Page '%s' FAILED: %s", page_id, e)
                raise
            completed["count"] += 1
            if on_progress:
                pct = 42 + int((completed["count"] / total_pages) * 55)
                on_progress("generate", pct, f"Generated page {completed['count']}/{total_pages}: {pp.get('title', page_id)}")
            if on_page:
                on_page(result[0], result[1])
            return result

    tasks = [
        _generate_page_limited(page_id, pp.model_dump() if hasattr(pp, "model_dump") else pp)
        for page_id, pp in pages_plan.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

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
        "doc_type": doc_type,
        "title": plan.title,
        "description": plan.description,
        "navigation": [g.model_dump() for g in plan.navigation],
        "pages": pages,
    }
