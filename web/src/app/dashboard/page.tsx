"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { IconLoader2, IconSparkles, IconHistory, IconFileText, IconX } from "@tabler/icons-react";
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
  const [history, setHistory] = useState<{ id: string; slug: string; repoName: string; docType: string; updatedAt: string }[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [currentRepoName, setCurrentRepoName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setGenerating(false);
    setProgress(0);
    setProgressMessage("");
  }, []);

  const refreshHistory = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setHistory(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => { setRepos(Array.isArray(data) ? data : []); setReposLoading(false); })
      .catch(() => setReposLoading(false));

    // Load project history
    refreshHistory();
  }, [refreshHistory]);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo) return;
    setGenerating(true);
    setDocs(null);
    setError(null);
    setProgress(0);
    setProgressMessage("Starting...");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: selectedRepo.clone_url,
          doc_type: docType === "auto" ? null : docType,
          stream: true,
        }),
        signal: controller.signal,
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
        let currentEvent = "";
        let currentData = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6).trim();
            } else if (line === "") {
              // Empty line = end of event block
              if (currentEvent && currentData) {
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
                      refreshHistory();
                    } else {
                      setError("No docs returned");
                    }
                  } else if (currentEvent === "saved") {
                    // Server persisted the docs and returned the slug
                    if (parsed.slug) setCurrentSlug(parsed.slug);
                    if (parsed.repoName) setCurrentRepoName(parsed.repoName);
                  } else if (currentEvent === "error") {
                    setError(parsed.error || "Generation failed");
                  }
                } catch {
                  // skip malformed JSON
                }
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
          if (data.slug) setCurrentSlug(data.slug);
          setCurrentRepoName(selectedRepo.name);
          refreshHistory();
        } else {
          setError("No docs returned");
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // User cancelled -- not an error
      } else {
        setError(e instanceof Error ? e.message : "Generation failed");
      }
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  }, [selectedRepo, docType, refreshHistory]);

  const handleRefine = async (prompt: string) => {
    const repoName = selectedRepo?.name || currentRepoName;
    if (!docs || !repoName) return;
    setRefining(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refine",
          current_docs: docs,
          prompt,
          repo_name: repoName,
          repo_url: selectedRepo?.clone_url || "",
        }),
      });
      const data = await res.json();
      if (data.docs) {
        setDocs(data.docs);
        if (data.slug) setCurrentSlug(data.slug);
        refreshHistory();
      }
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
        {/* Top half: repos */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          <RepoList repos={repos} selectedRepo={selectedRepo} onSelect={setSelectedRepo} loading={reposLoading} />
        </div>

        {/* Bottom half: history */}
        <div
          className="flex-1 flex flex-col overflow-hidden border-t"
          style={{ borderColor: "var(--color-border)", minHeight: 0 }}
        >
          {/* Fixed header -- does not scroll */}
          <p
            className="text-xs px-5 py-3 flex-shrink-0"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "1px", textTransform: "uppercase" }}
          >
            <IconHistory size={11} className="inline mr-1.5" style={{ verticalAlign: "-1px" }} />
            History
          </p>

          {/* Scrollable history list */}
          <div className="flex flex-col gap-1 p-3 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            {history.length === 0 ? (
              <p className="text-xs px-2" style={{ fontFamily: "var(--font-serif)", color: "var(--color-subtle)" }}>
                Generated docs will appear here
              </p>
            ) : (
              history.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    // Load docs from history
                    fetch(`/api/projects/${project.slug}`)
                      .then((r) => r.json())
                      .then((data) => {
                        if (data.docs) {
                          setDocs(data.docs);
                          setCurrentSlug(project.slug);
                          setCurrentRepoName(project.repoName);
                        }
                      })
                      .catch(() => {});
                  }}
                  className="flex flex-col gap-0.5 text-left px-3 py-2 rounded-xl cursor-pointer transition-colors border-none"
                  style={{ backgroundColor: "transparent" }}
                >
                  <div className="flex items-center gap-2">
                    <IconFileText size={13} style={{ color: "var(--color-muted)" }} />
                    <span className="text-sm truncate" style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)" }}>
                      {project.repoName}
                    </span>
                  </div>
                  <span className="text-xs pl-5" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)" }}>
                    {project.docType} &middot; {new Date(project.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

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
              onClick={generating ? handleCancel : handleGenerate}
              className="flex items-center justify-center gap-2 w-full cursor-pointer"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                backgroundColor: generating ? "transparent" : "var(--color-dark)",
                color: generating ? "var(--color-muted)" : "var(--bg-primary)",
                borderRadius: "var(--radius-full)",
                padding: "12px 20px",
                border: generating ? "1px solid var(--color-border)" : "none",
                transition: "var(--transition)",
              }}
            >
              {generating ? (
                <><IconX size={14} /> Cancel</>
              ) : (
                <><IconSparkles size={14} /> Generate Docs</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        <DocsPreview docs={docs} loading={generating} error={error} progress={progress} progressMessage={progressMessage} slug={currentSlug} />
        <PromptBar onSubmit={handleRefine} loading={refining || generating} disabled={!docs} />
      </div>
    </div>
  );
}
