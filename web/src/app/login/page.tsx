"use client";

import { signIn } from "next-auth/react";
import { SessionProvider } from "next-auth/react";
import { IconBrandGithub } from "@tabler/icons-react";

function LoginContent() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="flex flex-col items-center gap-10 max-w-md w-full px-6">
        <div className="flex flex-col items-center gap-3">
          <h1
            className="text-4xl tracking-tight"
            style={{ fontFamily: "var(--font-sans)", fontWeight: 500, color: "var(--color-dark)", letterSpacing: "-0.03em" }}
          >
            better-docs
          </h1>
          <p
            className="text-center text-base"
            style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}
          >
            Instant documentation from any codebase.
            <br />
            Point at a repo, get a live docs site.
          </p>
        </div>

        <button
          onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
          className="flex items-center gap-3 w-full justify-center cursor-pointer"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            letterSpacing: "1.5px",
            textTransform: "uppercase" as const,
            backgroundColor: "var(--color-dark)",
            color: "var(--bg-primary)",
            borderRadius: "var(--radius-full)",
            padding: "14px 32px",
            border: "none",
            transition: "var(--transition)",
          }}
        >
          <IconBrandGithub size={18} />
          Sign in with GitHub
        </button>

        <p
          className="text-xs text-center"
          style={{ fontFamily: "var(--font-mono)", color: "var(--color-subtle)", letterSpacing: "0.5px" }}
        >
          Read only access. We never modify your code.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <SessionProvider>
      <LoginContent />
    </SessionProvider>
  );
}
