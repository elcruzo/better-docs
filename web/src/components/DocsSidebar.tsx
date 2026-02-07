"use client";

import type { NavGroup } from "@/types";

interface Props {
  navigation: NavGroup[];
  activePage: string;
  onPageSelect: (page: string) => void;
}

export default function DocsSidebar({ navigation, activePage, onPageSelect }: Props) {
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
            {group.pages.map((page) => (
              <button
                key={page}
                onClick={() => onPageSelect(page)}
                className="text-left px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: activePage === page ? 500 : 400,
                  color: activePage === page ? "var(--color-dark)" : "var(--color-muted)",
                  backgroundColor: activePage === page ? "var(--color-border)" : "transparent",
                  border: "none",
                }}
              >
                {page.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
