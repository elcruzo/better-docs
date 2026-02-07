"use client";

import { useSession, signOut } from "next-auth/react";
import { IconLogout, IconBook2 } from "@tabler/icons-react";

export default function Navbar() {
  const { data: session } = useSession();

  return (
    <nav
      className="flex items-center justify-between px-6 h-14 border-b"
      style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-2">
        <IconBook2 size={20} style={{ color: "var(--color-dark)" }} />
        <span
          className="text-base"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)", letterSpacing: "-0.02em" }}
        >
          better-docs
        </span>
      </div>

      {session?.user && (
        <div className="flex items-center gap-4">
          <span
            className="text-xs"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-muted)", letterSpacing: "0.5px" }}
          >
            {session.user.name}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-1.5 cursor-pointer"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "var(--color-muted)",
              background: "none",
              border: "none",
              transition: "var(--transition)",
            }}
          >
            <IconLogout size={14} />
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
