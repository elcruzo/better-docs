import httpx, os

ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:3001")

_client = httpx.AsyncClient(base_url=ENGINE_URL, timeout=180)

async def parse_repo(repo_path: str, repo_name: str) -> dict:
    r = await _client.post("/index", json={"repo_path": repo_path, "repo_name": repo_name})
    return r.json()

async def classify_repo(repo_name: str) -> dict:
    r = await _client.post("/classify", json={"repo_name": repo_name})
    return r.json()

async def query_graph(repo_name: str, query_type: str) -> dict:
    r = await _client.post("/graph/query", json={"repo_name": repo_name, "query_type": query_type})
    return r.json()
