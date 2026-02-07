import os, shutil
from typing import TypedDict, Optional
from langgraph.graph import StateGraph, END
from app.nodes.clone import clone_repo, get_repo_name
from app.nodes.parse import parse_repo, classify_repo, query_graph
from app.nodes.generate import generate_docs

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
        return {**state, "repo_path": path, "repo_name": name, "readme": readme}
    except Exception as e:
        return {**state, "error": str(e)}

async def parse_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    stats = await parse_repo(state["repo_path"], state["repo_name"])
    return {**state, "index_stats": stats}

async def classify_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    if state.get("doc_type"):
        return state
    classification = await classify_repo(state["repo_name"])
    return {**state, "doc_type": classification.get("doc_type", "devdocs"), "classification": classification}

async def structure_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    result = await query_graph(state["repo_name"], "structure")
    return {**state, "structure": result.get("structure", [])}

async def generate_node(state: PipelineState) -> PipelineState:
    if state.get("error"):
        return state
    docs = await generate_docs(state["structure"], state["doc_type"], state["repo_name"], state.get("readme", ""))
    if state.get("repo_path"):
        shutil.rmtree(state["repo_path"], ignore_errors=True)
    return {**state, "docs": docs}

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
