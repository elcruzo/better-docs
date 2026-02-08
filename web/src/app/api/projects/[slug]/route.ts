import { NextResponse } from "next/server";
import { getDocs } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const { slug } = params;

  try {
    const result = await getDocs(slug);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { project } = result;
    return NextResponse.json({
      slug: project.slug,
      repoName: project.repoName,
      repoUrl: project.repoUrl,
      docType: project.docType,
      docs: project.docs,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  } catch (error) {
    console.error("Failed to get project:", error);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}
