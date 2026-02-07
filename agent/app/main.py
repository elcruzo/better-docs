import json, logging, asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
load_dotenv()

from app.models import GenerateRequest, RefineRequest
from app.pipeline import build_pipeline, run_pipeline_streaming
from app.nodes.refine import refine_docs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("agent")

app = FastAPI(title="better-docs agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

pipeline = build_pipeline()

@app.get("/health")
async def health():
    return {"status": "ok", "service": "better-docs-agent"}

@app.post("/generate")
async def generate(req: GenerateRequest):
    log.info(f"POST /generate -- repo_url={req.repo_url} doc_type={req.doc_type}")
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
    try:
        result = await pipeline.ainvoke(initial_state)
        if result.get("error"):
            log.error(f"  Pipeline error: {result['error']}")
            return {"error": result["error"]}
        pages = result.get("docs", {}).get("pages", {})
        log.info(f"  Done! Generated {len(pages)} pages")
        return {
            "docs": result["docs"],
            "classification": result.get("classification"),
            "index_stats": result.get("index_stats"),
        }
    except Exception as e:
        log.exception(f"  Exception in /generate: {e}")
        return {"error": str(e)}


@app.post("/generate/stream")
async def generate_stream(req: GenerateRequest):
    """SSE endpoint that streams progress events during doc generation."""
    log.info(f"POST /generate/stream -- repo_url={req.repo_url} doc_type={req.doc_type}")

    # Queue for SSE events -- pipeline pushes, generator pops
    queue: asyncio.Queue = asyncio.Queue()

    def on_progress(step: str, progress: int, message: str):
        queue.put_nowait({"event": "progress", "data": {"step": step, "progress": progress, "message": message}})

    async def run_and_finish():
        try:
            result = await run_pipeline_streaming(req.repo_url, req.doc_type, on_progress)
            if result.get("error"):
                queue.put_nowait({"event": "error", "data": {"error": result["error"]}})
            else:
                queue.put_nowait({"event": "done", "data": result})
        except Exception as e:
            log.exception(f"  Exception in /generate/stream: {e}")
            queue.put_nowait({"event": "error", "data": {"error": str(e)}})
        finally:
            queue.put_nowait(None)  # sentinel to stop the generator

    async def event_generator():
        # Start pipeline in background task
        task = asyncio.create_task(run_and_finish())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event = item["event"]
                data = json.dumps(item["data"])
                yield f"event: {event}\ndata: {data}\n\n"
        except asyncio.CancelledError:
            task.cancel()
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/refine")
async def refine(req: RefineRequest):
    log.info(f"POST /refine -- repo={req.repo_name} prompt={req.prompt[:80]}")
    try:
        updated = await refine_docs(req.current_docs.model_dump(), req.prompt, req.repo_name)
        log.info(f"  Refined successfully")
        return {"docs": updated}
    except Exception as e:
        log.exception(f"  Exception in /refine: {e}")
        return {"error": str(e)}
