import { notFound } from "next/navigation";
import { cache } from "react";
import { getDocs } from "@/lib/storage";
import PublicDocsViewer from "./PublicDocsViewer";

export const revalidate = 60;

const getCachedDocs = cache((slug: string) => getDocs(slug));

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props) {
  const result = await getCachedDocs(params.slug);
  if (!result) return { title: "Not Found" };
  return {
    title: `${result.project.repoName} — better-docs`,
    description: result.project.docs.description,
  };
}

export default async function PublicDocsPage({ params }: Props) {
  const result = await getCachedDocs(params.slug);
  if (!result) notFound();

  const { project } = result;

  return (
    <PublicDocsViewer
      docs={project.docs}
      repoName={project.repoName}
      repoUrl={project.repoUrl}
      slug={project.slug}
    />
  );
}
