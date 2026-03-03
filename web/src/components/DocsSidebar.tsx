"use client";

import type { NavGroup, DocPage } from "@/types";

interface Props {
  navigation: NavGroup[];
  activePage: string;
  onPageSelect: (page: string) => void;
  loadedPages?: Record<string, DocPage>;
}

export default function DocsSidebar({ navigation, activePage, onPageSelect, loadedPages }: Props) {
  return (
    <aside
      className="w-56 flex-shrink-0 overflow-y-auto py-5 px-3 border-r"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--bg-primary)" }}
    >
      {navigation.map((group) => (
        <div key={group.group} className="mb-5">
          <p
            className="text-xs px-2 mb-2"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-subtle)",
              letterSpacing: "1px",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {group.group}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.pages.map((page) => {
              const isLoaded = loadedPages ? !!(loadedPages[page] || loadedPages[page.toLowerCase()]) : true;
              return (
                <button
                  key={page}
                  onClick={() => onPageSelect(page)}
                  className="text-left px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm flex items-center gap-2"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: activePage === page ? 500 : 400,
                    color: activePage === page
                      ? "var(--bg-primary)"
                      : isLoaded
                        ? "var(--color-muted)"
                        : "var(--color-subtle)",
                    backgroundColor: activePage === page ? "var(--color-dark)" : "transparent",
                    border: "none",
                    opacity: isLoaded ? 1 : 0.6,
                    transition: "all 0.3s ease",
                  }}
                >
                  {!isLoaded && (
                    <span
                      className="inline-block w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                      style={{ backgroundColor: "var(--color-subtle)" }}
                    />
                  )}
                  <span>{page.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
