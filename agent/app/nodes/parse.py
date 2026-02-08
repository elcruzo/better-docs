import httpx, os, logging
from pathlib import Path

ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:3001")
log = logging.getLogger("agent")

_client = httpx.AsyncClient(base_url=ENGINE_URL, timeout=180)

# Extensions the engine's tree-sitter parser supports
PARSEABLE_EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".rs", ".go", ".java",
    ".rb", ".php", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
}

MAX_FILE_SIZE = 256_000  # 256KB -- skip huge files

async def parse_repo(repo_path: str, repo_name: str) -> dict:
    """Walk the cloned repo, read each parseable file, and send its content
    to the engine's /parse endpoint. This avoids needing a shared filesystem
    between the agent and engine containers."""
    root = Path(repo_path)
    files_sent = 0
    files_skipped = 0
    total_symbols = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in PARSEABLE_EXTS:
            files_skipped += 1
            continue
        # Skip node_modules, .git, vendor, etc.
        rel = str(path.relative_to(root))
        if any(part.startswith(".") or part in ("node_modules", "vendor", "__pycache__", "dist", "build", "target") for part in rel.split("/")):
            files_skipped += 1
            continue
        if path.stat().st_size > MAX_FILE_SIZE:
            files_skipped += 1
            continue

        try:
            content = path.read_text(errors="replace")
        except Exception:
            files_skipped += 1
            continue

        try:
            r = await _client.post("/parse", json={
                "filename": rel,
                "content": content,
                "repo_name": repo_name,
            })
            data = r.json()
            parsing = data.get("parsing", {})
            total_symbols += len(parsing.get("symbols", []))
            files_sent += 1
        except Exception as e:
            log.warning("Failed to parse %s: %s", rel, e)
            files_skipped += 1

    log.info("Parsed %d files (%d skipped), %d symbols total", files_sent, files_skipped, total_symbols)
    return {"files_processed": files_sent, "files_skipped": files_skipped, "nodes_created": total_symbols}


async def classify_repo(repo_name: str) -> dict:
    r = await _client.post("/classify", json={"repo_name": repo_name})
    return r.json()

async def query_graph(repo_name: str, query_type: str) -> dict:
    r = await _client.post("/graph/query", json={"repo_name": repo_name, "query_type": query_type})
    return r.json()
