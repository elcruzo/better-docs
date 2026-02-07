import type { Repo } from "@/types";

export async function fetchUserRepos(token: string): Promise<Repo[]> {
  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  return res.json();
}
