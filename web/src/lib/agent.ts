import type { GeneratedDocs } from "@/types";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// --- Non-streaming (kept for refine + fallback) ---

export async function generateDocs(repoUrl: string, docType?: string): Promise<{ docs: GeneratedDocs; classification?: Record<string, unknown>; index_stats?: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const res = await fetch(`${AGENT_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_url: repoUrl, doc_type: docType || null }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Agent error ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function refineDocs(currentDocs: GeneratedDocs, prompt: string, repoName: string): Promise<{ docs: GeneratedDocs }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch(`${AGENT_URL}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_docs: currentDocs, prompt, repo_name: repoName }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Agent error ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --- SSE streaming (server-side: reads from agent, returns parsed events) ---

export interface ProgressEvent {
  step: string;
  progress: number;
  message: string;
}

export async function generateDocsStream(
  repoUrl: string,
  docType?: string,
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  const res = await fetch(`${AGENT_URL}/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, doc_type: docType || null }),
    signal: controller.signal,
  });

  if (!res.ok) {
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    throw new Error(`Agent error ${res.status}: ${text}`);
  }

  if (!res.body) {
    clearTimeout(timeout);
    throw new Error("No response body for SSE stream");
  }

  // Return the raw stream -- the API route will pipe it through
  // Clear timeout when the stream ends naturally
  const body = res.body;
  const reader = body.getReader();

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        clearTimeout(timeout);
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      clearTimeout(timeout);
      reader.cancel();
    },
  });
}
