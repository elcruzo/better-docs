import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import authOptions from "@/lib/auth";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import { ThemeProvider } from "@/components/ThemeProvider";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <Providers>
      <ThemeProvider>
        <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "var(--bg-primary)", color: "var(--color-dark)", transition: "background-color 0.2s ease, color 0.2s ease" }}>
          <Navbar />
          {children}
        </div>
      </ThemeProvider>
    </Providers>
  );
}
