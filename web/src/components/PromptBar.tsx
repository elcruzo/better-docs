"use client";

import { useState } from "react";
import { IconSend } from "@tabler/icons-react";

interface Props {
  onSubmit: (prompt: string) => void;
  loading: boolean;
  disabled?: boolean;
}

export default function PromptBar({ onSubmit, loading, disabled }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || loading || disabled) return;
    onSubmit(value.trim());
    setValue("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl"
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--color-border)",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={loading ? "Refining..." : disabled ? "Generate docs first to refine them" : "Refine the docs... (e.g. 'add more detail to the API section')"}
        disabled={loading || disabled}
        className="flex-1 text-sm outline-none bg-transparent"
        style={{
          fontFamily: "var(--font-serif)",
          color: "var(--color-dark)",
          caretColor: "var(--color-dark)",
        }}
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="flex items-center justify-center w-8 h-8 rounded-full cursor-pointer transition-opacity"
        style={{
          backgroundColor: value.trim() ? "var(--color-dark)" : "var(--color-border)",
          color: value.trim() ? "var(--bg-primary)" : "var(--color-subtle)",
          border: "none",
          opacity: loading ? 0.5 : 1,
        }}
      >
        <IconSend size={14} />
      </button>
    </form>
  );
}
