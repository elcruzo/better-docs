"use client";

import { IconGitBranch, IconLock, IconStar } from "@tabler/icons-react";
import type { Repo } from "@/types";

interface Props {
  repos: Repo[];
  selectedRepo: Repo | null;
  onSelect: (repo: Repo) => void;
  loading: boolean;
}

export default function RepoList({ repos, selectedRepo, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
      {/* Fixed header -- does not scroll */}
      <p
        className="text-xs px-5 py-3 flex-shrink-0"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-subtle)",
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        Your Repositories
      </p>

      {/* Scrollable repo list */}
      <div className="flex flex-col gap-1 p-3 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
        {repos.map((repo) => (
          <button
            key={repo.id}
            onClick={() => onSelect(repo)}
            className="flex flex-col gap-1 text-left px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
            style={{
              backgroundColor: selectedRepo?.id === repo.id ? "var(--color-border)" : "transparent",
              border: "none",
            }}
          >
            <div className="flex items-center gap-2">
              <IconGitBranch size={14} style={{ color: "var(--color-muted)" }} />
              <span
                className="text-sm truncate"
                style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)" }}
              >
                {repo.name}
              </span>
              {repo.private && <IconLock size={12} style={{ color: "var(--color-subtle)" }} />}
            </div>
            <div className="flex items-center gap-3 pl-5">
              {repo.language && (
                <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)" }}>
                  {repo.language}
                </span>
              )}
              {repo.stargazers_count > 0 && (
                <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-subtle)" }}>
                  <IconStar size={11} /> {repo.stargazers_count}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
