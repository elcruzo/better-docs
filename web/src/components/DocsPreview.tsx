"use client";

import { useState } from "react";
import type { GeneratedDocs } from "@/types";
import DocsSidebar from "./DocsSidebar";
import DocsContent from "./DocsContent";

export default function DocsPreview({ docs }: { docs: GeneratedDocs | null }) {
  const [activePage, setActivePage] = useState<string>("");

  if (!docs) {
    return (
      <div
        className="flex-1 flex items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <p className="text-base" style={{ fontFamily: "var(--font-serif)", color: "var(--color-subtle)" }}>
            Select a repository and generate docs
          </p>
          <p className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "0.5px" }}>
            Documentation will appear here
          </p>
        </div>
      </div>
    );
  }

  const currentPageId = activePage || docs.navigation[0]?.pages[0] || "";
  const currentPage = docs.pages[currentPageId] || null;

  return (
    <div
      className="flex-1 flex rounded-2xl overflow-hidden"
      style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--color-border)" }}
    >
      <DocsSidebar navigation={docs.navigation} activePage={currentPageId} onPageSelect={setActivePage} />
      <DocsContent page={currentPage} />
    </div>
  );
}
