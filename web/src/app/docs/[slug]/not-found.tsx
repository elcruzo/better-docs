export default function DocsNotFound() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <p
          className="text-5xl"
          style={{ fontFamily: "var(--font-mono)", color: "var(--color-dark)", fontWeight: 300 }}
        >
          404
        </p>
        <p
          className="text-base"
          style={{ fontFamily: "var(--font-serif)", color: "var(--color-muted)" }}
        >
          These docs don&apos;t exist yet.
        </p>
        <a
          href="https://better-docs.xyz"
          className="text-xs no-underline px-4 py-2 rounded-full transition-colors"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--bg-primary)",
            backgroundColor: "var(--color-dark)",
            letterSpacing: "1px",
          }}
        >
          Generate docs &rarr;
        </a>
      </div>
    </div>
  );
}
