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
  },
  pages: { signIn: "/login" },
};

export default authOptions;
