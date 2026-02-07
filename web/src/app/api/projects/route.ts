import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import authOptions from "@/lib/auth";
import { listUserProjects } from "@/lib/storage";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session as any).userId;
  if (!userId) return NextResponse.json({ error: "no user id" }, { status: 401 });

  try {
    const projects = await listUserProjects(userId);
    return NextResponse.json(projects);
  } catch (error) {
    console.error("Failed to list projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}
