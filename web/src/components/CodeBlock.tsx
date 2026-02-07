"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

const theme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: "#2a2119", fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.6" },
  'pre[class*="language-"]': { color: "#2a2119", fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.6", padding: "16px 20px", borderRadius: "12px", backgroundColor: "#f5f0ea", border: "1px solid var(--color-border)", overflow: "auto" },
  comment: { color: "#8b7e74" },
  string: { color: "#7d5b83" },
  keyword: { color: "#5c3a2e" },
  number: { color: "#9c7261" },
  function: { color: "#2a2119", fontWeight: "500" },
  operator: { color: "#2a2119" },
  punctuation: { color: "#8b7e74" },
};

export default function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <SyntaxHighlighter language={language || "text"} style={theme} customStyle={{ margin: 0, borderRadius: "12px" }}>
      {code}
    </SyntaxHighlighter>
  );
}
