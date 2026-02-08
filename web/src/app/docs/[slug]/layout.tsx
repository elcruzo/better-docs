import { ThemeProvider } from "@/components/ThemeProvider";

export default function DocsPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div
        className="h-screen flex flex-col overflow-hidden"
        style={{
          backgroundColor: "var(--bg-primary)",
          color: "var(--color-dark)",
          transition: "background-color 0.2s ease, color 0.2s ease",
        }}
      >
        {children}
      </div>
    </ThemeProvider>
  );
}
