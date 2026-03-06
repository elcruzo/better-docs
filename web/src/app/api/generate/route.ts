import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import authOptions from "@/lib/auth";
import { generateDocs, generateDocsStream, refineDocs } from "@/lib/agent";
import { saveDocs } from "@/lib/storage";

export const maxDuration = 660;

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

      // Intercept stream: forward all events to client, but also detect
      // page and done events so we can persist docs to the DB.
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const encoder = new TextEncoder();

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);

          if (userId) {
            sseBuffer += decoder.decode(chunk, { stream: true });
          }
        },
        async flush(controller) {
          if (!userId) return;
          try {
            // Parse ALL SSE events to reconstruct docs from streamed pages
            const lines = sseBuffer.split("\n");
            let currentEvent = "";
            let planData: Record<string, unknown> | null = null;
            const streamedPages: Record<string, unknown> = {};
            let doneDocs: Record<string, unknown> | null = null;

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                const dataStr = line.slice(6).trim();
                try {
                  const parsed = JSON.parse(dataStr);
                  if (currentEvent === "page") {
                    const { page_id, page } = parsed;
                    if (page_id === "__plan__") {
                      planData = page;
                    } else if (page_id && page) {
                      streamedPages[page_id] = page;
                    }
                  } else if (currentEvent === "done" && parsed.docs) {
                    doneDocs = parsed.docs;
                  }
                } catch {
                  // skip malformed JSON
                }
              } else if (line === "") {
                currentEvent = "";
              }
            }

            // Prefer the done event's docs, but fall back to reconstructing
            // from streamed pages if done never arrived (timeout/error)
            let docsToSave = doneDocs;
            if (!docsToSave && planData && Object.keys(streamedPages).length > 0) {
              docsToSave = {
                doc_type: (planData as any).doc_type || "",
                title: (planData as any).title || repoName,
                description: (planData as any).description || "",
                navigation: (planData as any).navigation || [],
                pages: streamedPages,
              };
            }

            if (docsToSave) {
              const { slug } = await saveDocs(userId, repoUrl, repoName, docsToSave as any);
              console.log(`Persisted docs for ${repoName} -> ${slug} (${Object.keys((docsToSave as any).pages || {}).length} pages)`);
              const savedEvent = `event: saved\ndata: ${JSON.stringify({ slug, repoName })}\n\n`;
              controller.enqueue(encoder.encode(savedEvent));
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
