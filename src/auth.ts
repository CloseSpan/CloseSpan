import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { recordWorkspaceAccessAttempt } from "@/lib/access-waitlist-repository";
import {
  applicationMode,
  hasWorkspaceMembership,
  normalizeEmail,
} from "@/lib/auth-user";
import { PUBLIC_DISCOVERY_PATHS } from "@/lib/site";

const PUBLIC_PAGES = new Set<string>(PUBLIC_DISCOVERY_PATHS);

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, profile }) {
      const googleProfile = profile as { email?: string } | undefined;
      if (googleProfile?.email) token.email = normalizeEmail(googleProfile.email);
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") {
        session.user.email = token.email;
      }
      return session;
    },
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const googleProfile = profile as
        | { email?: string; email_verified?: boolean }
        | undefined;
      const email = googleProfile?.email
        ? normalizeEmail(googleProfile.email)
        : "";
      if (!email || googleProfile?.email_verified !== true) return false;
      if (applicationMode() === "demo") return true;
      if (await hasWorkspaceMembership(email)) return true;

      try {
        await recordWorkspaceAccessAttempt(
          email,
          typeof profile?.name === "string" ? profile.name : null,
        );
      } catch (error) {
        console.error("Unable to record a workspace access attempt", error);
        return false;
      }

      // Keep the verified Google identity so the denial page can explain
      // which account was waitlisted. Workspace access is checked separately.
      return true;
    },
    async authorized({ auth: session, request }) {
      if (PUBLIC_PAGES.has(request.nextUrl.pathname)) return true;
      const email = session?.user?.email
        ? normalizeEmail(session.user.email)
        : "";
      if (!email) return false;
      if (applicationMode() === "demo") return true;
      try {
        return await hasWorkspaceMembership(email);
      } catch (error) {
        console.error("Unable to verify workspace access", error);
        return false;
      }
    },
  },
});
