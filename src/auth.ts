import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { recordPlatformUserSignIn } from "@/lib/active-user-repository";
import { normalizeEmail } from "@/lib/auth-user";
import { PUBLIC_DISCOVERY_PATHS } from "@/lib/site";
import { readPlatformUserStatus } from "@/lib/platform-user-access";

const PUBLIC_PAGES = new Set<string>([
  ...PUBLIC_DISCOVERY_PATHS,
  "/waitlist",
  "/github/connection-result",
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
      try {
        const status = await readPlatformUserStatus(email);
        if (status !== "Active") return `/login?error=Account${status}`;
      } catch {
        // Access controls fail closed; analytics below remains best effort.
        return "/login?error=AccountAccessUnavailable";
      }
      try {
        await recordPlatformUserSignIn(
          email,
          typeof profile?.name === "string" ? profile.name : null,
        );
      } catch (error) {
        console.error("Unable to record verified user sign-in activity", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
      return true;
    },
    async authorized({ auth: session, request }) {
      if (PUBLIC_PAGES.has(request.nextUrl.pathname)) return true;
      const email = session?.user?.email
        ? normalizeEmail(session.user.email)
        : "";
      return Boolean(email);
    },
  },
});
