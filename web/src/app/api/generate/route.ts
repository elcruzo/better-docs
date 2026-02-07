import { NextResponse } from "next/server";
import { generateDocs, refineDocs } from "@/lib/agent";

export async function POST(req: Request) {
  const body = await req.json();

  if (body.action === "refine") {
    const result = await refineDocs(body.current_docs, body.prompt, body.repo_name);
    return NextResponse.json(result);
  }

  const result = await generateDocs(body.repo_url, body.doc_type);
  return NextResponse.json(result);
}
