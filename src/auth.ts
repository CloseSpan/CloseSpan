import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const PUBLIC_PAGES = new Set(["/", "/login"]);

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
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const googleProfile = profile as
        | { email?: string; email_verified?: boolean }
        | undefined;
      return Boolean(
        googleProfile?.email &&
          googleProfile.email_verified === true,
      );
    },
    authorized({ auth: session, request }) {
      if (PUBLIC_PAGES.has(request.nextUrl.pathname)) return true;
      return Boolean(session?.user?.email);
    },
  },
});
