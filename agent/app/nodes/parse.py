import httpx, os

ENGINE_URL = os.getenv("ENGINE_URL", "http://localhost:3001")

async def parse_repo(repo_path: str, repo_name: str) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{ENGINE_URL}/index", json={"repo_path": repo_path, "repo_name": repo_name})
        return r.json()

async def classify_repo(repo_name: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{ENGINE_URL}/classify", json={"repo_name": repo_name})
        return r.json()

async def query_graph(repo_name: str, query_type: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{ENGINE_URL}/graph/query", json={"repo_name": repo_name, "query_type": query_type})
        return r.json()
