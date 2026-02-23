import asyncio, tempfile, shutil, logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def clone_repo(repo_url: str) -> str:
    tmp = tempfile.mkdtemp(prefix="betterdocs_")
    logger.info("Cloning %s into %s", repo_url, tmp)
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", repo_url, tmp,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("Clone timed out after 120 seconds. The repository may be too large or unreachable.")

    if proc.returncode != 0:
        err = stderr.decode().strip() if stderr else ""
        logger.error("git clone failed (exit %d): %s", proc.returncode, err)
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"Failed to clone repository: {err or 'unknown git error (exit 128)'}")

    logger.info("Clone successful: %s", tmp)
    return tmp


def get_repo_name(repo_url: str) -> str:
    return repo_url.rstrip("/").split("/")[-1].replace(".git", "")
