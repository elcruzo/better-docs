import type { GeneratedDocs } from "@/types";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export async function generateDocs(repoUrl: string, docType?: string): Promise<{ docs: GeneratedDocs; classification?: Record<string, unknown>; index_stats?: Record<string, unknown> }> {
  const res = await fetch(`${AGENT_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, doc_type: docType || null }),
  });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.json();
}

export async function refineDocs(currentDocs: GeneratedDocs, prompt: string, repoName: string): Promise<{ docs: GeneratedDocs }> {
  const res = await fetch(`${AGENT_URL}/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_docs: currentDocs, prompt, repo_name: repoName }),
  });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.json();
}
