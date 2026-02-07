import tempfile, subprocess
from pathlib import Path

def clone_repo(repo_url: str) -> str:
    tmp = tempfile.mkdtemp(prefix="betterdocs_")
    subprocess.run(["git", "clone", "--depth", "1", repo_url, tmp], check=True, capture_output=True)
    return tmp

def get_repo_name(repo_url: str) -> str:
    return repo_url.rstrip("/").split("/")[-1].replace(".git", "")
