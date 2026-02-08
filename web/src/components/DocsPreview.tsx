"use client";

import { useState } from "react";
import { IconExternalLink, IconCopy, IconCheck } from "@tabler/icons-react";
import type { GeneratedDocs } from "@/types";
import DocsSidebar from "./DocsSidebar";
import DocsContent from "./DocsContent";

interface DocsPreviewProps {
  docs: GeneratedDocs | null;
  loading?: boolean;
  error?: string | null;
  progress?: number;
  progressMessage?: string;
  slug?: string | null;
}

const STEP_LABELS: Record<string, string> = {
  clone: "Cloning",
  parse: "Parsing",
  classify: "Classifying",
  structure: "Mapping",
  generate: "Generating",
};

function getStepLabel(message: string): string {
  for (const [key, label] of Object.entries(STEP_LABELS)) {
    if (message.toLowerCase().includes(key)) return label;
  }
  return "Processing";
}

export default function DocsPreview({ docs, loading, error, progress = 0, progressMessage = "", slug }: DocsPreviewProps) {
  const [activePage, setActivePage] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const liveUrl = slug ? `https://${slug}.better-docs.xyz` : null;
  const localUrl = slug ? `/docs/${slug}` : null;

  const handleCopyUrl = () => {
    if (!liveUrl) return;
    navigator.clipboard.writeText(liveUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div
        className="flex-1 flex items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex flex-col items-center gap-6 w-full max-w-md px-8">
          {/* Step indicator */}
          <div className="flex flex-col items-center gap-2">
            <p
              className="text-sm tracking-widest uppercase"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)", letterSpacing: "2px" }}
            >
              {progress < 5 ? "Initializing" : getStepLabel(progressMessage)}
            </p>
          </div>

          {/* Progress bar container */}
          <div className="w-full">
            <div
              className="w-full h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: "var(--color-border)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(progress, 2)}%`,
                  backgroundColor: "var(--color-dark)",
                  transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              />
            </div>

            {/* Percentage + message */}
            <div className="flex justify-between items-center mt-3">
              <p
                className="text-xs"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-subtle)",
                  letterSpacing: "0.5px",
                  maxWidth: "80%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {progressMessage || "Starting pipeline..."}
              </p>
              <p
                className="text-xs tabular-nums"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)", letterSpacing: "0.5px" }}
              >
                {progress}%
              </p>
            </div>
          </div>

          {/* Pipeline steps visualization */}
          <div className="flex gap-1 mt-2">
            {["clone", "parse", "classify", "structure", "generate"].map((step, i) => {
              const thresholds = [5, 15, 28, 35, 40];
              const isActive = progress >= thresholds[i];
              const isCurrent = progress >= thresholds[i] && (i === 4 || progress < thresholds[i + 1]);
              return (
                <div
                  key={step}
                  className="flex flex-col items-center gap-1"
                  style={{ opacity: isActive ? 1 : 0.3, transition: "opacity 0.5s ease" }}
                >
                  <div
                    className="rounded-full"
                    style={{
                      width: isCurrent ? "8px" : "6px",
                      height: isCurrent ? "8px" : "6px",
                      backgroundColor: isActive ? "var(--color-dark)" : "var(--color-border)",
                      transition: "all 0.5s ease",
                    }}
                  />
                  <span
                    className="text-xs"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "9px",
                      letterSpacing: "0.5px",
                      color: isActive ? "var(--color-dark)" : "var(--color-subtle)",
                      transition: "color 0.5s ease",
                    }}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!docs) {
    return (
      <div
        className="flex-1 flex items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex flex-col items-center gap-3">
          {error ? (
            <>
              <p className="text-base" style={{ fontFamily: "var(--font-serif)", color: "#c0392b" }}>
                Generation failed
              </p>
              <p className="text-xs max-w-md text-center" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "0.5px" }}>
                {error}
              </p>
            </>
          ) : (
            <>
              <p className="text-base" style={{ fontFamily: "var(--font-serif)", color: "var(--color-subtle)" }}>
                Select a repository and generate docs
              </p>
              <p className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "0.5px" }}>
                Documentation will appear here
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const currentPageId = activePage || docs.navigation[0]?.pages[0] || "";

  // Fuzzy page lookup: try exact match first, then case-insensitive
  const findPage = (id: string) => {
    if (docs.pages[id]) return docs.pages[id];
    // Try case-insensitive match
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
    <div
      className="flex-1 flex flex-col rounded-2xl overflow-hidden"
      style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--color-border)" }}
    >
      {/* Top bar with view/deploy controls */}
      {slug && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--bg-primary)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "0.5px" }}
            >
              {liveUrl}
            </span>
            <button
              onClick={handleCopyUrl}
              className="p-1 rounded cursor-pointer border-none bg-transparent transition-colors"
              style={{ color: copied ? "#2a7d4f" : "var(--color-subtle)" }}
              title="Copy URL"
            >
              {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            </button>
          </div>
          <a
            href={localUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs no-underline transition-colors cursor-pointer"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--bg-primary)",
              backgroundColor: "var(--color-dark)",
              letterSpacing: "1px",
            }}
          >
            View Live
            <IconExternalLink size={12} />
          </a>
        </div>
      )}

      {/* Docs content */}
      <div className="flex flex-1 overflow-hidden">
        <DocsSidebar navigation={filteredNav} activePage={currentPageId} onPageSelect={setActivePage} />
        <DocsContent page={currentPage} />
      </div>
    </div>
  );
}
