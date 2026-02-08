import type { AuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma) as AuthOptions["adapter"],
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: { params: { scope: "read:user user:email repo" } },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // Attach userId and GitHub access token to the session
      if (session.user) {
        (session as any).userId = user.id;
      }
      // Get the access token from the Account table
      const account = await prisma.account.findFirst({
        where: { userId: user.id, provider: "github" },
        select: { access_token: true },
      });
      if (account?.access_token) {
        (session as any).accessToken = account.access_token;
      }
      return session;
    },
    async signIn({ account }) {
      // Persist token updates on every sign-in (GitHub rotates tokens)
      if (account && account.provider === "github") {
        try {
          await prisma.account.updateMany({
            where: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
            data: {
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
              session_state: account.session_state as string | null,
            },
          });
        } catch (e) {
          console.error("Failed to update account tokens:", e);
        }
      }
      return true;
    },
  },
  pages: { signIn: "/login" },
};

export default authOptions;
