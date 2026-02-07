import { NextResponse } from "next/server";
import { getDocs } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const { slug } = params;

  try {
    const result = await getDocs(slug);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ docs: result.project.docs });
  } catch (error) {
    console.error("Failed to get project:", error);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}
