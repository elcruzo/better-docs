import os, shutil, logging, time
from typing import TypedDict, Optional, Callable
from langgraph.graph import StateGraph, END
from app.nodes.clone import clone_repo, get_repo_name
from app.nodes.parse import parse_repo, classify_repo, query_graph
from app.nodes.generate import generate_docs

log = logging.getLogger("agent")

ProgressCallback = Optional[Callable[[str, int, str], None]]

class PipelineState(TypedDict):
    repo_url: str
    repo_path: Optional[str]
    repo_name: Optional[str]
    doc_type: Optional[str]
    index_stats: Optional[dict]
    structure: Optional[list]
    classification: Optional[dict]
    readme: Optional[str]
    docs: Optional[dict]
    error: Optional[str]

async def clone_node(state: PipelineState) -> PipelineState:
    log.info("[1/5 clone] Cloning %s", state["repo_url"])
    t = time.time()
    try:
        path = clone_repo(state["repo_url"])
        name = get_repo_name(state["repo_url"])
        readme = ""
        for f in ["README.md", "readme.md", "README.rst", "README"]:
            rp = os.path.join(path, f)
            if os.path.exists(rp):
                with open(rp) as fh:
                    readme = fh.read()
                break
        log.info("[1/5 clone] Done in %.1fs -- name=%s readme=%d chars path=%s", time.time()-t, name, len(readme), path)
        return {**state, "repo_path": path, "repo_name": name, "readme": readme}
    except Exception as e:
        log.error("[1/5 clone] FAILED: %s", e)
        return {**state, "error": str(e)}

async def parse_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    log.info("[2/5 parse] Sending to engine: %s", state["repo_name"])
    t = time.time()
    try:
        stats = await parse_repo(state["repo_path"], state["repo_name"])
        log.info("[2/5 parse] Done in %.1fs -- %s", time.time()-t, stats)
        return {**state, "index_stats": stats}
    except Exception as e:
        log.error("[2/5 parse] FAILED: %s", e)
        return {**state, "error": f"Parse failed: {e}"}

async def classify_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    if state.get("doc_type"):
        log.info("[3/5 classify] Skipped -- user provided doc_type=%s", state["doc_type"])
        return state
    log.info("[3/5 classify] Auto-classifying %s", state["repo_name"])
    t = time.time()
    try:
        classification = await classify_repo(state["repo_name"])
        log.info("[3/5 classify] Done in %.1fs -- %s", time.time()-t, classification)
        return {**state, "doc_type": classification.get("doc_type", "devdocs"), "classification": classification}
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
        if state.get("repo_path"):
            shutil.rmtree(state["repo_path"], ignore_errors=True)
        return {**state, "docs": docs}
    except Exception as e:
        log.error("[5/5 generate] FAILED: %s", e)
        if state.get("repo_path"):
            shutil.rmtree(state["repo_path"], ignore_errors=True)
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
    graph.add_edge("parse", "classify")
    graph.add_edge("classify", "structure")
    graph.add_edge("structure", "generate")
    graph.add_edge("generate", END)
    return graph.compile()


# --- Streaming pipeline runner (bypasses LangGraph for SSE support) ---

async def run_pipeline_streaming(
    repo_url: str,
    doc_type: str | None,
    on_progress: Callable[[str, int, str], None],
) -> dict:
    """Run the full pipeline with progress callbacks for SSE streaming.
    This runs the same logic as the LangGraph pipeline but step-by-step
    so we can emit progress events between steps.
    """
    state: PipelineState = {
        "repo_url": repo_url,
        "repo_path": None,
        "repo_name": None,
        "doc_type": doc_type,
        "index_stats": None,
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
    on_progress("parse", 15, f"Parsing codebase with tree-sitter...")
    state = await parse_node(state)
    if state.get("error"):
        return {"error": state["error"]}

    stats = state.get("index_stats", {})
    file_count = stats.get("files_indexed", "?")
    on_progress("parse", 25, f"Parsed {file_count} files")

    # Step 3: Classify
    if not state.get("doc_type"):
        on_progress("classify", 28, "Classifying documentation type...")
    state = await classify_node(state)

    on_progress("classify", 32, f"Doc type: {state.get('doc_type', 'devdocs')}")

    # Step 4: Structure
    on_progress("structure", 35, "Building code structure graph...")
    state = await structure_node(state)
    if state.get("error"):
        return {"error": state["error"]}

    structure = state.get("structure", [])
    total_symbols = sum(len(f.get("symbols", [])) for f in structure)
    on_progress("structure", 38, f"Mapped {len(structure)} files, {total_symbols} symbols")

    # Step 5: Generate (with per-page progress)
    on_progress("generate", 40, "Planning documentation structure...")
    try:
        docs = await generate_docs(
            structure,
            state["doc_type"],
            state["repo_name"],
            state.get("readme", ""),
            on_progress=on_progress,
        )
    except Exception as e:
        if state.get("repo_path"):
            shutil.rmtree(state["repo_path"], ignore_errors=True)
        return {"error": f"Generation failed: {e}"}

    # Cleanup
    if state.get("repo_path"):
        shutil.rmtree(state["repo_path"], ignore_errors=True)

    return {
        "docs": docs,
        "classification": state.get("classification"),
        "index_stats": state.get("index_stats"),
    }
