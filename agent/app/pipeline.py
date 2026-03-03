import asyncio, json, os, shutil, logging, time
from typing import TypedDict, Optional, Callable
from langgraph.graph import StateGraph, END
from app.nodes.clone import clone_repo, get_repo_name
from app.nodes.parse import parse_repo, query_graph
from app.nodes.generate import generate_docs
from app.llm import get_llm
from langchain_core.messages import SystemMessage, HumanMessage

log = logging.getLogger("agent")

PageCallback = Optional[Callable[[str, dict], None]]

_classify_llm = get_llm()

CLASSIFY_PROMPT = """You are a documentation type classifier. Given a repository's README and file list, determine what kind of documentation to generate.

Choose exactly ONE doc_type from:
- "consumer" — end-user facing product/app docs (getting started, features, guides, FAQ)
- "devdocs" — developer API reference (endpoints, classes, methods, types, error codes)
- "library" — reusable library/package docs (installation, usage, API, examples)
- "cli" — command-line tool docs (commands, flags, configuration, examples)

Return ONLY a JSON object:
{"doc_type": "...", "reasoning": "one sentence explaining why"}"""

class PipelineState(TypedDict):
    repo_url: str
    repo_path: Optional[str]
    repo_name: Optional[str]
    doc_type: Optional[str]
    github_token: Optional[str]
    index_stats: Optional[dict]
    file_paths: Optional[list]
    structure: Optional[list]
    classification: Optional[dict]
    readme: Optional[str]
    docs: Optional[dict]
    error: Optional[str]

async def clone_node(state: PipelineState) -> PipelineState:
    log.info("[1/5 clone] Cloning %s", state["repo_url"])
    t = time.time()
    try:
        path = await clone_repo(state["repo_url"], state.get("github_token"))
        name = get_repo_name(state["repo_url"])
        readme = ""
        for f in ["README.md", "readme.md", "README.rst", "README"]:
            rp = os.path.join(path, f)
            if os.path.exists(rp):
                readme = await asyncio.to_thread(_read_file, rp)
                break
        log.info("[1/5 clone] Done in %.1fs -- name=%s readme=%d chars path=%s", time.time()-t, name, len(readme), path)
        return {**state, "repo_path": path, "repo_name": name, "readme": readme}
    except Exception as e:
        log.error("[1/5 clone] FAILED: %s", e)
        return {**state, "error": str(e)}


def _read_file(path: str) -> str:
    with open(path) as fh:
        return fh.read()


async def parse_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    log.info("[2/5 parse] Sending to engine: %s", state["repo_name"])
    t = time.time()
    try:
        stats = await parse_repo(state["repo_path"], state["repo_name"])
        log.info("[2/5 parse] Done in %.1fs -- %s", time.time()-t, stats)
        return {**state, "index_stats": stats, "file_paths": stats.get("file_paths", [])}
    except Exception as e:
        log.error("[2/5 parse] FAILED: %s", e)
        return {**state, "error": f"Parse failed: {e}"}
    finally:
        # Repo is no longer needed after parsing -- free disk space early
        if state.get("repo_path"):
            await asyncio.to_thread(shutil.rmtree, state["repo_path"], True)

async def classify_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    if state.get("doc_type"):
        log.info("[3/5 classify] Skipped -- user provided doc_type=%s", state["doc_type"])
        return state
    log.info("[3/5 classify] LLM-classifying %s", state["repo_name"])
    t = time.time()
    try:
        file_paths = state.get("file_paths", [])
        readme = state.get("readme", "")
        file_tree = "\n".join(file_paths[:500])

        user_msg = f"""Repository: {state["repo_name"]}
{len(file_paths)} files total.

README (first 3000 chars):
{readme[:3000] if readme else "No README found."}

File tree:
{file_tree}

Return the doc_type JSON."""

        response = await asyncio.wait_for(
            _classify_llm.ainvoke([
                SystemMessage(content=CLASSIFY_PROMPT),
                HumanMessage(content=user_msg),
            ]),
            timeout=30,
        )
        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            result = json.loads(text[start:end])
        else:
            result = json.loads(text)

        doc_type = result.get("doc_type", "devdocs")
        valid_types = {"consumer", "devdocs", "library", "cli"}
        if doc_type not in valid_types:
            doc_type = "devdocs"

        log.info("[3/5 classify] Done in %.1fs -- %s (%s)", time.time()-t, doc_type, result.get("reasoning", ""))
        return {**state, "doc_type": doc_type, "classification": result}
    except Exception as e:
        log.error("[3/5 classify] FAILED: %s", e)
        return {**state, "doc_type": "devdocs", "classification": {"error": str(e)}}

async def structure_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    log.info("[4/5 structure] Querying graph for %s", state["repo_name"])
    t = time.time()
    try:
        result = await query_graph(state["repo_name"], "structure")
        structure = result.get("structure", [])
        total_symbols = sum(len(f.get("symbols", [])) for f in structure)
        log.info("[4/5 structure] Done in %.1fs -- %d files, %d symbols", time.time()-t, len(structure), total_symbols)
        return {**state, "structure": structure}
    except Exception as e:
        log.error("[4/5 structure] FAILED: %s", e)
        return {**state, "error": f"Structure query failed: {e}"}

async def generate_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    log.info("[5/5 generate] Generating %s docs for %s (%d files in structure)",
             state["doc_type"], state["repo_name"], len(state.get("structure", [])))
    t = time.time()
    try:
        docs = await generate_docs(state["structure"], state["doc_type"], state["repo_name"], state.get("readme", ""))
        pages = docs.get("pages", {})
        log.info("[5/5 generate] Done in %.1fs -- %d pages generated", time.time()-t, len(pages))
        return {**state, "docs": docs}
    except Exception as e:
        log.error("[5/5 generate] FAILED: %s", e)
        return {**state, "error": f"Generation failed: {e}"}

def build_pipeline():
    graph = StateGraph(PipelineState)
    graph.add_node("clone", clone_node)
    graph.add_node("parse", parse_node)
    graph.add_node("classify", classify_node)
    graph.add_node("structure", structure_node)
    graph.add_node("generate", generate_node)
    graph.set_entry_point("clone")
    graph.add_edge("clone", "parse")
    # Fan-out: classify and structure are independent, run concurrently
    graph.add_edge("parse", "classify")
    graph.add_edge("parse", "structure")
    # Fan-in: generate waits for both
    graph.add_edge("classify", "generate")
    graph.add_edge("structure", "generate")
    graph.add_edge("generate", END)
    return graph.compile()


# --- Streaming pipeline runner (bypasses LangGraph for SSE support) ---


async def run_pipeline_streaming(
    repo_url: str,
    doc_type: str | None,
    on_progress: Callable[[str, int, str], None],
    github_token: str | None = None,
    on_page: PageCallback = None,
) -> dict:
    """Run the full pipeline with progress callbacks for SSE streaming.
    on_page(page_id, page_data) streams each completed page immediately."""
    state: PipelineState = {
        "repo_url": repo_url,
        "repo_path": None,
        "repo_name": None,
        "doc_type": doc_type,
        "github_token": github_token,
        "index_stats": None,
        "file_paths": None,
        "structure": None,
        "classification": None,
        "readme": None,
        "docs": None,
        "error": None,
    }

    # Step 1: Clone
    on_progress("clone", 5, "Cloning repository...")
    state = await clone_node(state)
    if state.get("error"):
        return {"error": state["error"]}

    # Step 2: Parse
    on_progress("parse", 15, "Parsing codebase with tree-sitter...")
    state = await parse_node(state)
    if state.get("error"):
        return {"error": state["error"]}

    stats = state.get("index_stats", {})
    file_count = stats.get("files_processed", stats.get("files_indexed", "?"))
    on_progress("parse", 25, f"Parsed {file_count} files")

    # Steps 3+4: Classify and Structure run concurrently
    on_progress("classify", 28, "Classifying & building structure...")

    classify_task = asyncio.create_task(classify_node(state))
    structure_task = asyncio.create_task(structure_node(state))
    classify_result, structure_result = await asyncio.gather(classify_task, structure_task)

    # Merge results from both concurrent steps
    state = {**state, **classify_result, **structure_result}

    if state.get("error"):
        return {"error": state["error"]}

    on_progress("classify", 32, f"Doc type: {state.get('doc_type', 'devdocs')}")

    structure = state.get("structure", [])
    total_symbols = sum(len(f.get("symbols", [])) for f in structure)
    on_progress("structure", 38, f"Mapped {len(structure)} files, {total_symbols} symbols")

    # Step 5: Generate
    on_progress("generate", 40, "Planning documentation structure...")
    try:
        docs = await generate_docs(
            structure,
            state["doc_type"],
            state["repo_name"],
            state.get("readme", ""),
            on_progress=on_progress,
            on_page=on_page,
        )
    except Exception as e:
        return {"error": f"Generation failed: {e}"}

    return {
        "docs": docs,
        "classification": state.get("classification"),
        "index_stats": state.get("index_stats"),
    }
