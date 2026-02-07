import { prisma } from "@/lib/db";
import type { GeneratedDocs } from "@/types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function saveDocs(
  userId: string,
  repoUrl: string,
  repoName: string,
  docs: GeneratedDocs,
): Promise<{ slug: string }> {
  // Include userId prefix to prevent cross-user slug collisions
  const slug = `${slugify(repoName)}-${userId.slice(0, 8)}`;

  await prisma.project.upsert({
    where: { slug },
    update: {
      docs: docs as any,
      docType: docs.doc_type,
      repoUrl: repoUrl || undefined,
      updatedAt: new Date(),
    },
    create: {
      slug,
      repoUrl,
      repoName,
      userId,
      docs: docs as any,
      docType: docs.doc_type,
    },
  });

  return { slug };
}

export async function getDocs(slug: string): Promise<{ project: { slug: string; repoName: string; docType: string; docs: GeneratedDocs; updatedAt: Date } } | null> {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { slug: true, repoName: true, docType: true, docs: true, updatedAt: true },
  });
  if (!project) return null;
  return { project: { ...project, docs: project.docs as unknown as GeneratedDocs } };
}

export async function listUserProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    select: { id: true, slug: true, repoName: true, repoUrl: true, docType: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function deleteProject(slug: string, userId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { slug }, select: { userId: true } });
  if (!project || project.userId !== userId) return false;
  await prisma.project.delete({ where: { slug } });
  return true;
}
