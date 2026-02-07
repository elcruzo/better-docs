"use client";

import { useState } from "react";
import type { GeneratedDocs } from "@/types";
import DocsSidebar from "./DocsSidebar";
import DocsContent from "./DocsContent";

interface DocsPreviewProps {
  docs: GeneratedDocs | null;
  loading?: boolean;
  error?: string | null;
  progress?: number;
  progressMessage?: string;
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

export default function DocsPreview({ docs, loading, error, progress = 0, progressMessage = "" }: DocsPreviewProps) {
  const [activePage, setActivePage] = useState<string>("");

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
