import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { recordWorkspaceAccessAttempt } from "@/lib/access-waitlist-repository";
import { normalizeEmail } from "@/lib/auth-user";
import { PUBLIC_DISCOVERY_PATHS } from "@/lib/site";
import {
  isPrivateBetaAccessEnforced,
  isPrivateBetaOwner,
} from "@/lib/workspace-access-policy";

const PUBLIC_PAGES = new Set<string>([
  ...PUBLIC_DISCOVERY_PATHS,
  "/waitlist",
]);

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
      if (!isPrivateBetaAccessEnforced()) return true;
      if (isPrivateBetaOwner(email)) return true;

      try {
        await recordWorkspaceAccessAttempt(
          email,
          typeof profile?.name === "string" ? profile.name : null,
        );
      } catch (error) {
        console.error("Unable to record a workspace access attempt", error);
      }

      // Every verified identity receives a session. The private beta access
      // boundary is enforced separately so non-owner users can see their
      // successful waitlist confirmation instead of an authentication error.
      return true;
    },
    async authorized({ auth: session, request }) {
      if (PUBLIC_PAGES.has(request.nextUrl.pathname)) return true;
      const email = session?.user?.email
        ? normalizeEmail(session.user.email)
        : "";
      if (!email) return false;
      if (!isPrivateBetaAccessEnforced()) return true;
      if (isPrivateBetaOwner(email)) return true;

      return Response.redirect(new URL("/waitlist", request.nextUrl));
    },
  },
});
