"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { IconSparkles, IconHistory, IconFileText, IconX, IconMenu2 } from "@tabler/icons-react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

    refreshHistory();
  }, [refreshHistory]);

  const handleSelectRepo = useCallback((repo: Repo) => {
    setSelectedRepo(repo);
    setSidebarOpen(false);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedRepo) return;
    setGenerating(true);
    setDocs(null);
    setError(null);
    setProgress(0);
    setProgressMessage("Starting...");
    setSidebarOpen(false);

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
          buffer = lines.pop() || "";

          let receivedDone = false;

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6).trim();
            } else if (line === "") {
              if (currentEvent && currentData) {
                try {
                  const parsed = JSON.parse(currentData);

                  if (currentEvent === "progress") {
                    setProgress(parsed.progress || 0);
                    setProgressMessage(parsed.message || "");
                  } else if (currentEvent === "page") {
                    const { page_id, page } = parsed;
                    if (page_id === "__plan__") {
                      setDocs({
                        doc_type: page.doc_type || "",
                        title: page.title || "",
                        description: page.description || "",
                        navigation: page.navigation || [],
                        pages: {},
                      });
                    } else if (page_id && page) {
                      setDocs((prev: GeneratedDocs | null) => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          pages: { ...prev.pages, [page_id]: page },
                        };
                      });
                    }
                  } else if (currentEvent === "done") {
                    receivedDone = true;
                    if (parsed.docs) {
                      setDocs((prev: GeneratedDocs | null) => {
                        if (!prev) return parsed.docs;
                        const mergedPages = { ...prev.pages };
                        for (const [id, page] of Object.entries(parsed.docs.pages || {})) {
                          mergedPages[id] = page as import("@/types").DocPage;
                        }
                        return {
                          doc_type: parsed.docs.doc_type || prev.doc_type,
                          title: parsed.docs.title || prev.title,
                          description: parsed.docs.description || prev.description,
                          navigation: parsed.docs.navigation || prev.navigation,
                          pages: mergedPages,
                        };
                      });
                      setProgress(100);
                      setProgressMessage("Done!");
                      refreshHistory();
                    } else {
                      setError("No docs returned");
                    }
                  } else if (currentEvent === "saved") {
                    if (parsed.slug) setCurrentSlug(parsed.slug);
                    if (parsed.repoName) setCurrentRepoName(parsed.repoName);
                  } else if (currentEvent === "error") {
                    setError(parsed.error || "Generation failed");
                    receivedDone = true;
                  }
                } catch {
                  // skip malformed JSON
                }
              }
              currentEvent = "";
              currentData = "";
            }
          }

          if (receivedDone) break;
        }
      } else {
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
        // User cancelled
      } else {
        setError(e instanceof Error ? e.message : "Connection lost — try again for smaller repos or check your network");
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
    setError(null);
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
      if (data.error) {
        setError(data.error);
      } else if (data.docs) {
        setDocs(data.docs);
        if (data.slug) setCurrentSlug(data.slug);
        refreshHistory();
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Refine failed — try again");
    } finally {
      setRefining(false);
    }
  };

  const sidebarContent = (
    <>
      {/* Top half: repos */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
        <RepoList repos={repos} selectedRepo={selectedRepo} onSelect={handleSelectRepo} loading={reposLoading} />
      </div>

      {/* Bottom half: history */}
      <div
        className="flex-1 flex flex-col overflow-hidden border-t"
        style={{ borderColor: "var(--color-border)", minHeight: 0 }}
      >
        <p
          className="text-xs px-5 py-3 flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "1px", textTransform: "uppercase" }}
        >
          <IconHistory size={11} className="inline mr-1.5" style={{ verticalAlign: "-1px" }} />
          History
        </p>

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
                  fetch(`/api/projects/${project.slug}`)
                    .then((r) => r.json())
                    .then((data) => {
                      if (data.docs) {
                        setDocs(data.docs);
                        setCurrentSlug(project.slug);
                        setCurrentRepoName(project.repoName);
                        setSidebarOpen(false);
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
    </>
  );

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="md:hidden fixed bottom-20 left-4 z-40 flex items-center justify-center w-12 h-12 rounded-full shadow-lg cursor-pointer"
        style={{
          backgroundColor: "var(--color-dark)",
          color: "var(--bg-primary)",
          border: "none",
        }}
      >
        <IconMenu2 size={20} />
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed on desktop, drawer on mobile */}
      <div
        className={`
          fixed md:relative z-50 md:z-auto
          h-full md:h-auto
          w-72 flex-shrink-0 border-r flex flex-col
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--bg-primary)" }}
      >
        {/* Mobile close button */}
        <div className="md:hidden flex items-center justify-end p-2">
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-2 rounded-lg cursor-pointer"
            style={{ background: "none", border: "none", color: "var(--color-muted)" }}
          >
            <IconX size={18} />
          </button>
        </div>
        {sidebarContent}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col p-2 md:p-4 overflow-hidden min-w-0">
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mb-2 md:mb-4">
          <DocsPreview docs={docs} loading={generating && !docs} generating={generating} refining={refining} error={error} progress={progress} progressMessage={progressMessage} slug={currentSlug} />
        </div>
        <div className="flex-shrink-0">
          <PromptBar onSubmit={handleRefine} loading={refining || generating} disabled={!docs} />
        </div>
      </div>

      {/* Mobile bottom bar: selected repo + generate */}
      {selectedRepo && !sidebarOpen && !docs && (
        <div
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3 border-t"
          style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--color-border)" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate" style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)" }}>
              {selectedRepo.name}
            </p>
            <p className="text-xs truncate" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)" }}>
              {docType === "auto" ? "Auto-detect" : docType}
            </p>
          </div>
          <button
            onClick={generating ? handleCancel : handleGenerate}
            className="flex items-center gap-2 cursor-pointer flex-shrink-0"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              backgroundColor: generating ? "transparent" : "var(--color-dark)",
              color: generating ? "var(--color-muted)" : "var(--bg-primary)",
              borderRadius: "var(--radius-full)",
              padding: "10px 20px",
              border: generating ? "1px solid var(--color-border)" : "none",
            }}
          >
            {generating ? (
              <><IconX size={13} /> Cancel</>
            ) : (
              <><IconSparkles size={13} /> Generate</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
