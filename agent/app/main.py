from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
load_dotenv()

from app.models import GenerateRequest, RefineRequest
from app.pipeline import build_pipeline
from app.nodes.refine import refine_docs

app = FastAPI(title="better-docs agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

pipeline = build_pipeline()

@app.get("/health")
async def health():
    return {"status": "ok", "service": "better-docs-agent"}

@app.post("/generate")
async def generate(req: GenerateRequest):
    initial_state = {
        "repo_url": req.repo_url,
        "repo_path": None,
        "repo_name": None,
        "doc_type": req.doc_type,
        "index_stats": None,
        "structure": None,
        "classification": None,
        "readme": None,
        "docs": None,
        "error": None,
    }
    result = await pipeline.ainvoke(initial_state)
    if result.get("error"):
        return {"error": result["error"]}
    return {
        "docs": result["docs"],
        "classification": result.get("classification"),
        "index_stats": result.get("index_stats"),
    }

@app.post("/refine")
async def refine(req: RefineRequest):
    updated = await refine_docs(req.current_docs.model_dump(), req.prompt, req.repo_name)
    return {"docs": updated}
