"use client";

import { useState, useEffect, useCallback } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import type { Repo, GeneratedDocs } from "@/types";
import RepoList from "@/components/RepoList";
import DocsPreview from "@/components/DocsPreview";
import PromptBar from "@/components/PromptBar";

const DOC_TYPES = [
  { value: "auto", label: "Auto-detect" },
  { value: "consumer", label: "Consumer Docs" },
  { value: "devdocs", label: "DevDocs / API" },
  { value: "library", label: "Library Docs" },
  { value: "cli", label: "CLI Docs" },
];

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [docType, setDocType] = useState("auto");
  const [docs, setDocs] = useState<GeneratedDocs | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => { setRepos(Array.isArray(data) ? data : []); setReposLoading(false); })
      .catch(() => setReposLoading(false));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo) return;
    setGenerating(true);
    setDocs(null);
    setError(null);
    setProgress(0);
    setProgressMessage("Starting...");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: selectedRepo.clone_url,
          doc_type: docType === "auto" ? null : docType,
          stream: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Server error ${res.status}`);
        setGenerating(false);
        return;
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream") && res.body) {
        // Parse SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete line in buffer

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6).trim();
            } else if (line === "" && currentEvent && currentData) {
              // End of event block
              try {
                const parsed = JSON.parse(currentData);

                if (currentEvent === "progress") {
                  setProgress(parsed.progress || 0);
                  setProgressMessage(parsed.message || "");
                } else if (currentEvent === "done") {
                  if (parsed.docs) {
                    setDocs(parsed.docs);
                    setProgress(100);
                    setProgressMessage("Done!");
                  } else {
                    setError("No docs returned");
                  }
                } else if (currentEvent === "error") {
                  setError(parsed.error || "Generation failed");
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } else {
        // Fallback: JSON response
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else if (data.docs) {
          setDocs(data.docs);
        } else {
          setError("No docs returned");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [selectedRepo, docType]);

  const handleRefine = async (prompt: string) => {
    if (!docs || !selectedRepo) return;
    setRefining(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refine",
          current_docs: docs,
          prompt,
          repo_name: selectedRepo.name,
        }),
      });
      const data = await res.json();
      if (data.docs) setDocs(data.docs);
    } catch (e) {
      console.error(e);
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left sidebar */}
      <div
        className="w-72 flex-shrink-0 border-r flex flex-col"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--bg-primary)" }}
      >
        <RepoList repos={repos} selectedRepo={selectedRepo} onSelect={setSelectedRepo} loading={reposLoading} />

        {/* Doc type + generate */}
        {selectedRepo && (
          <div className="p-4 flex flex-col gap-3 border-t mt-auto" style={{ borderColor: "var(--color-border)" }}>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-xl outline-none cursor-pointer"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--color-dark)",
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--color-border)",
                letterSpacing: "0.5px",
              }}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center justify-center gap-2 w-full cursor-pointer"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                backgroundColor: "var(--color-dark)",
                color: "var(--bg-primary)",
                borderRadius: "var(--radius-full)",
                padding: "12px 20px",
                border: "none",
                opacity: generating ? 0.7 : 1,
                transition: "var(--transition)",
              }}
            >
              {generating ? (
                <><IconLoader2 size={14} className="animate-spin" /> Generating...</>
              ) : (
                <><IconSparkles size={14} /> Generate Docs</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        <DocsPreview docs={docs} loading={generating} error={error} progress={progress} progressMessage={progressMessage} />
        <PromptBar onSubmit={handleRefine} loading={refining || generating} />
      </div>
    </div>
  );
}
