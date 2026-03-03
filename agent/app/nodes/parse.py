import asyncio, httpx, os, logging
from pathlib import Path

ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:3001")
log = logging.getLogger("agent")

_client = httpx.AsyncClient(
    base_url=ENGINE_URL,
    timeout=180,
    limits=httpx.Limits(max_connections=30, max_keepalive_connections=10),
)

MAX_FILE_SIZE = 256_000
SKIP_DIRS = {"node_modules", "vendor", "__pycache__", "dist", "build", "target", ".git"}
BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm", ".ogg", ".flac",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".lib", ".bin",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pyc", ".pyo", ".class", ".jar",
    ".DS_Store", ".lock",
}


def _is_text_file(path: Path) -> bool:
    """Quick check: skip known binary extensions, then verify the file is readable as text."""
    if path.suffix.lower() in BINARY_EXTS:
        return False
    if path.name in (".DS_Store", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock"):
        return False
    try:
        with open(path, "rb") as f:
            chunk = f.read(8192)
        if b"\x00" in chunk:
            return False
    except Exception:
        return False
    return True


def _collect_files(repo_path: str) -> list[tuple[str, str]]:
    """Collect all text files in the repo (called via asyncio.to_thread)."""
    root = Path(repo_path)
    files = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(root))
        if any(part.startswith(".") or part in SKIP_DIRS for part in rel.split("/")):
            continue
        if path.stat().st_size > MAX_FILE_SIZE:
            continue
        if not _is_text_file(path):
            continue
        try:
            content = path.read_text(errors="replace")
        except Exception:
            continue
        files.append((rel, content))
    return files


async def parse_repo(repo_path: str, repo_name: str) -> dict:
    """Walk the cloned repo and send all parseable files to the engine concurrently."""
    files_to_parse = await asyncio.to_thread(_collect_files, repo_path)

    sem = asyncio.Semaphore(20)
    total_symbols = 0
    files_sent = 0
    files_failed = 0
    lock = asyncio.Lock()

    async def _send(rel: str, content: str):
        nonlocal total_symbols, files_sent, files_failed
        async with sem:
            try:
                r = await _client.post("/parse", json={
                    "filename": rel,
                    "content": content,
                    "repo_name": repo_name,
                })
                data = r.json()
                symbols = len(data.get("parsing", {}).get("symbols", []))
                async with lock:
                    total_symbols += symbols
                    files_sent += 1
            except Exception as e:
                log.warning("Failed to parse %s: %s", rel, e)
                async with lock:
                    files_failed += 1

    await asyncio.gather(*[_send(rel, content) for rel, content in files_to_parse])

    files_skipped = files_failed
    log.info("Parsed %d files (%d skipped), %d symbols total", files_sent, files_skipped, total_symbols)
    return {"files_processed": files_sent, "files_skipped": files_skipped, "nodes_created": total_symbols}


async def classify_repo(repo_name: str) -> dict:
    r = await _client.post("/classify", json={"repo_name": repo_name})
    return r.json()

async def query_graph(repo_name: str, query_type: str) -> dict:
    r = await _client.post("/graph/query", json={"repo_name": repo_name, "query_type": query_type})
    return r.json()
