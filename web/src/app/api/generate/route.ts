import { NextResponse } from "next/server";
import { generateDocs, generateDocsStream, refineDocs } from "@/lib/agent";

export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "refine") {
      const result = await refineDocs(body.current_docs, body.prompt, body.repo_name);
      return NextResponse.json(result);
    }

    // Use SSE streaming if requested
    if (body.stream) {
      const stream = await generateDocsStream(body.repo_url, body.doc_type);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Fallback to non-streaming
    const result = await generateDocs(body.repo_url, body.doc_type);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Generate API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
