import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import authOptions from "@/lib/auth";
import { generateDocs, generateDocsStream, refineDocs } from "@/lib/agent";
import { saveDocs } from "@/lib/storage";

export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const session = await getServerSession(authOptions);
    const userId = (session as any)?.userId as string | undefined;
    const accessToken = (session as any)?.accessToken as string | undefined;

    if (body.action === "refine") {
      const result = await refineDocs(body.current_docs, body.prompt, body.repo_name);

      // Persist refined docs if user is logged in
      if (userId && result.docs && body.repo_name) {
        try {
          const { slug } = await saveDocs(userId, body.repo_url || "", body.repo_name, result.docs);
          return NextResponse.json({ ...result, slug });
        } catch (e) {
          console.error("Failed to persist refined docs:", e);
        }
      }

      return NextResponse.json(result);
    }

    // Use SSE streaming if requested
    if (body.stream) {
      const rawStream = await generateDocsStream(body.repo_url, body.doc_type, accessToken);
      const repoName = body.repo_url?.split("/").pop()?.replace(".git", "") || "unknown";
      const repoUrl = body.repo_url || "";

      // Intercept stream: forward all events to client, but also detect the
      // "done" event so we can persist docs to the DB.
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const encoder = new TextEncoder();

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          // Always forward the chunk to the client immediately
          controller.enqueue(chunk);

          // Also buffer it so we can parse SSE events
          if (userId) {
            sseBuffer += decoder.decode(chunk, { stream: true });
          }
        },
        async flush(controller) {
          // Stream ended -- check if we captured a "done" event with docs
          if (!userId) return;
          try {
            // Parse SSE events from the buffer to find the "done" event
            const lines = sseBuffer.split("\n");
            let currentEvent = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ") && currentEvent === "done") {
                const dataStr = line.slice(6).trim();
                const parsed = JSON.parse(dataStr);
                if (parsed.docs) {
                  const { slug } = await saveDocs(userId, repoUrl, repoName, parsed.docs);
                  console.log(`Persisted streaming docs for ${repoName} -> ${slug}`);
                  // Emit a "saved" event so the client knows the slug
                  const savedEvent = `event: saved\ndata: ${JSON.stringify({ slug, repoName })}\n\n`;
                  controller.enqueue(encoder.encode(savedEvent));
                }
                break;
              } else if (line === "") {
                if (currentEvent !== "done") currentEvent = "";
              }
            }
          } catch (e) {
            console.error("Failed to persist streaming docs:", e);
          }
        },
      });

      rawStream.pipeTo(writable).catch(() => {});

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Fallback to non-streaming
    const result = await generateDocs(body.repo_url, body.doc_type, accessToken);

    // Persist docs if user is logged in
    if (userId && result.docs) {
      try {
        const repoName = body.repo_url?.split("/").pop()?.replace(".git", "") || "unknown";
        const { slug } = await saveDocs(userId, body.repo_url, repoName, result.docs);
        return NextResponse.json({ ...result, slug });
      } catch (e) {
        console.error("Failed to persist docs:", e);
      }
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Generate API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
