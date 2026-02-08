"use client";

import { useState } from "react";
import { IconBrandGithub, IconExternalLink, IconMoon, IconSun } from "@tabler/icons-react";
import type { GeneratedDocs } from "@/types";
import DocsSidebar from "@/components/DocsSidebar";
import DocsContent from "@/components/DocsContent";
import { useTheme } from "@/components/ThemeProvider";

interface Props {
  docs: GeneratedDocs;
  repoName: string;
  repoUrl: string;
  slug: string;
}

export default function PublicDocsViewer({ docs, repoName, repoUrl, slug }: Props) {
  const [activePage, setActivePage] = useState<string>("");
  const { theme, toggle } = useTheme();

  const currentPageId = activePage || docs.navigation[0]?.pages[0] || "";

  // Fuzzy page lookup: try exact match first, then case-insensitive
  const findPage = (id: string) => {
    if (docs.pages[id]) return docs.pages[id];
    const lower = id.toLowerCase();
    const key = Object.keys(docs.pages).find((k) => k.toLowerCase() === lower);
    return key ? docs.pages[key] : null;
  };

  const currentPage = findPage(currentPageId);

  // Filter navigation to only include pages that actually exist
  const filteredNav = docs.navigation
    .map((group) => ({
      ...group,
      pages: group.pages.filter((p) => findPage(p) !== null),
    }))
    .filter((group) => group.pages.length > 0);

  return (
    <>
      {/* Minimal top bar */}
      <header
        className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--bg-primary)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-medium"
            style={{ fontFamily: "var(--font-sans)", color: "var(--color-dark)" }}
          >
            {repoName}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-subtle)",
              backgroundColor: "var(--bg-secondary)",
              letterSpacing: "0.5px",
            }}
          >
            {docs.doc_type}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="p-2 rounded-lg cursor-pointer border-none bg-transparent transition-colors"
            style={{ color: "var(--color-muted)" }}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
          </button>
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs no-underline transition-colors"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-muted)",
                backgroundColor: "var(--bg-secondary)",
                letterSpacing: "0.5px",
              }}
            >
              <IconBrandGithub size={14} />
              GitHub
              <IconExternalLink size={11} />
            </a>
          )}
          <a
            href="https://better-docs.xyz"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs no-underline transition-colors"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--bg-primary)",
              backgroundColor: "var(--color-dark)",
              letterSpacing: "0.5px",
            }}
          >
            Built with better-docs
          </a>
        </div>
      </header>

      {/* Docs content area */}
      <div className="flex flex-1 overflow-hidden">
        <DocsSidebar navigation={filteredNav} activePage={currentPageId} onPageSelect={setActivePage} />
        <DocsContent page={currentPage} />
      </div>
    </>
  );
}
