import tempfile, subprocess, shutil, logging
from pathlib import Path

logger = logging.getLogger(__name__)

def clone_repo(repo_url: str) -> str:
    # Verify git is available
    git_check = subprocess.run(["git", "--version"], capture_output=True, text=True)
    logger.info("git version: %s", git_check.stdout.strip())

    tmp = tempfile.mkdtemp(prefix="betterdocs_")
    logger.info("Cloning %s into %s", repo_url, tmp)
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", repo_url, tmp],
            capture_output=True, text=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("Clone timed out after 120 seconds. The repository may be too large or unreachable.")

    if result.returncode != 0:
        stderr = result.stderr.strip()
        logger.error("git clone failed (exit %d): %s", result.returncode, stderr)
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"Failed to clone repository: {stderr or 'unknown git error (exit 128)'}")

    logger.info("Clone successful: %s", tmp)
    return tmp

def get_repo_name(repo_url: str) -> str:
    return repo_url.rstrip("/").split("/")[-1].replace(".git", "")
