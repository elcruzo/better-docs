"use client";

import { useEffect, useRef, useState } from "react";
import type { DocPage, DocSection } from "@/types";
import CodeBlock from "./CodeBlock";
import CardGroup from "./CardGroup";

function EndpointCard({ section }: { section: DocSection }) {
  const methodColors: Record<string, string> = {
    GET: "#2a7d4f", POST: "#7d5b83", PUT: "#9c7261", DELETE: "#c94040", PATCH: "#5c6b3a",
  };
  const color = methodColors[section.method || "GET"] || "var(--color-dark)";

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--bg-card)" }}
    >
      <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-md"
          style={{ fontFamily: "var(--font-mono)", color, backgroundColor: `${color}12`, letterSpacing: "0.5px" }}
        >
          {section.method}
        </span>
        <code className="text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)" }}>
          {section.path}
        </code>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        {section.description && (
          <p className="text-sm" style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}>
            {section.description}
          </p>
        )}
        {section.params && section.params.length > 0 && (
          <div>
            <p className="text-xs mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", textTransform: "uppercase", letterSpacing: "1px" }}>
              Parameters
            </p>
            <div className="flex flex-col gap-1">
              {section.params.map((p, i) => (
                <div key={i} className="flex items-baseline gap-3 text-sm">
                  <code style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)", fontWeight: 500 }}>{p.name}</code>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", fontSize: "12px" }}>{p.type}</span>
                  <span style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}>{p.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {section.response && (
          <div>
            <p className="text-xs mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", textTransform: "uppercase", letterSpacing: "1px" }}>
              Response
            </p>
            <CodeBlock code={section.response} language="json" />
          </div>
        )}
      </div>
    </div>
  );
}

function renderSection(section: DocSection, i: number) {
  switch (section.type) {
    case "heading": {
      const level = section.level || 2;
      const sizes: Record<number, string> = { 1: "text-3xl", 2: "text-2xl", 3: "text-xl", 4: "text-lg" };
      const cls = `${sizes[level] || "text-xl"} pt-4`;
      const id = `section-${i}`;
      if (level === 1) return <h1 key={i} id={id} className={cls}>{section.content}</h1>;
      if (level === 3) return <h3 key={i} id={id} className={cls}>{section.content}</h3>;
      if (level === 4) return <h4 key={i} id={id} className={cls}>{section.content}</h4>;
      return <h2 key={i} id={id} className={cls}>{section.content}</h2>;
    }

    case "paragraph":
      return (
        <p key={i} className="text-base leading-relaxed" style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}>
          {section.content}
        </p>
      );

    case "codeBlock":
      return <div key={i}><CodeBlock code={section.content || ""} language={section.language} /></div>;

    case "endpoint":
      return <div key={i}><EndpointCard section={section} /></div>;

    case "cardGroup":
      return <div key={i}><CardGroup cards={section.cards || []} /></div>;

    case "table":
      return (
        <div key={i} className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
          <div
            className="text-sm"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)" }}
            dangerouslySetInnerHTML={{ __html: markdownTableToHtml(section.content || "") }}
          />
        </div>
      );

    case "list":
      return (
        <ul key={i} className="flex flex-col gap-1.5 pl-5" style={{ listStyleType: "disc" }}>
          {(section.items || []).map((item, j) => (
            <li key={j} className="text-sm" style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}>{item}</li>
          ))}
        </ul>
      );

    default:
      return section.content ? (
        <p key={i} className="text-sm" style={{ color: "var(--color-muted)" }}>{section.content}</p>
      ) : null;
  }
}

function markdownTableToHtml(md: string): string {
  const lines = md.trim().split("\n").filter((l) => !l.match(/^\|[\s-|]+\|$/));
  if (lines.length === 0) return md;
  const rows = lines.map((line) =>
    line.split("|").filter((c) => c.trim()).map((c) => c.trim())
  );
  const [header, ...body] = rows;
  let html = '<table style="width:100%;border-collapse:collapse">';
  html += "<thead><tr>" + header.map((h) => `<th style="text-align:left;padding:10px 14px;border-bottom:1px solid var(--color-border);font-family:var(--font-mono);font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:var(--color-subtle)">${h}</th>`).join("") + "</tr></thead>";
  html += "<tbody>" + body.map((row) => "<tr>" + row.map((c) => `<td style="padding:10px 14px;border-bottom:1px solid var(--color-border);font-family:var(--font-serif);font-size:14px;color:var(--color-muted)">${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
  return html;
}

// --- Minimap component ---

interface TocItem {
  id: string;
  label: string;
  level: number;
}

function Minimap({ items, activeId, scrollContainerRef }: { items: TocItem[]; activeId: string; scrollContainerRef: React.RefObject<HTMLDivElement | null> }) {
  if (items.length === 0) return null;

  const handleClick = (id: string) => {
    const el = scrollContainerRef.current?.querySelector(`#${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      className="w-44 flex-shrink-0 py-6 pr-4 overflow-y-auto"
      style={{ borderLeft: "1px solid var(--color-border)" }}
    >
      <p
        className="text-xs px-3 mb-3"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "1px", textTransform: "uppercase" }}
      >
        On this page
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => handleClick(item.id)}
            className="text-left px-3 py-1 cursor-pointer border-none bg-transparent transition-colors"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: item.level <= 2 ? "12px" : "11px",
              paddingLeft: item.level >= 3 ? "20px" : "12px",
              color: activeId === item.id ? "var(--color-dark)" : "var(--color-subtle)",
              fontWeight: activeId === item.id ? 500 : 400,
              borderLeft: activeId === item.id ? "2px solid var(--color-dark)" : "2px solid transparent",
              transition: "all 0.2s ease",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function DocsContent({ page }: { page: DocPage | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeHeading, setActiveHeading] = useState("");

  // Extract headings for minimap
  const tocItems: TocItem[] = page
    ? page.sections
        .map((s, i) => (s.type === "heading" ? { id: `section-${i}`, label: s.content || "", level: s.level || 2 } : null))
        .filter((x): x is TocItem => x !== null)
    : [];

  // Track scroll position to highlight active heading
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || tocItems.length === 0) return;

    const onScroll = () => {
      let current = "";
      for (const item of tocItems) {
        const el = container.querySelector(`#${item.id}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (rect.top - containerRect.top < 100) {
            current = item.id;
          }
        }
      }
      setActiveHeading(current);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // initial
    return () => container.removeEventListener("scroll", onScroll);
  }, [tocItems]);

  // Reset scroll and active heading when page changes
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setActiveHeading("");
  }, [page?.title]);

  if (!page) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--color-subtle)" }}>
        <p style={{ fontFamily: "var(--font-serif)" }}>Select a page from the sidebar</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <article ref={scrollRef} className="flex-1 overflow-y-auto px-10 py-8 max-w-3xl">
        <h1
          className="text-3xl mb-2"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)", letterSpacing: "-0.03em" }}
        >
          {page.title}
        </h1>
        {page.description && (
          <p className="text-base mb-10" style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}>
            {page.description}
          </p>
        )}
        <div className="flex flex-col gap-6">{page.sections.map((s, i) => renderSection(s, i))}</div>
      </article>
      <Minimap items={tocItems} activeId={activeHeading} scrollContainerRef={scrollRef} />
    </div>
  );
}
