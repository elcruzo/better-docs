"use client";

import { IconCode, IconServer, IconBook, IconSettings, IconShield, IconDatabase, IconTerminal, IconApi } from "@tabler/icons-react";

const ICON_MAP: Record<string, typeof IconCode> = {
  code: IconCode, server: IconServer, book: IconBook, settings: IconSettings,
  shield: IconShield, database: IconDatabase, terminal: IconTerminal, api: IconApi,
};

interface Card {
  title: string;
  description: string;
  icon?: string;
}

export default function CardGroup({ cards }: { cards: Card[] }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, 1fr)` }}>
      {cards.map((card, i) => {
        const Icon = ICON_MAP[card.icon || "code"] || IconCode;
        return (
          <div
            key={i}
            className="flex flex-col gap-2.5 p-5 rounded-2xl"
            style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--color-border)" }}
          >
            <Icon size={20} style={{ color: "var(--color-dark)" }} />
            <h4
              className="text-sm"
              style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)" }}
            >
              {card.title}
            </h4>
            <p className="text-sm" style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)", lineHeight: 1.5 }}>
              {card.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
