import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import {
  signInWithGoogle,
  signOutCurrentUser,
} from "@/app/auth-actions";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the Feelow AI workspace with Google.",
};

interface LoginPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}

function safeCallbackUrl(value: string | undefined): string {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  if (value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // Invalid callback values fall back to the workspace home.
    }
  }
  return "/overview";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const access = await resolveWorkspaceAccess();
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  if (access.status === "granted") redirect(callbackUrl);

  const accessDenied =
    access.status === "denied" || params.error === "AccessDenied";

  return (
    <main className="login-page">
      <Link className="login-back" href="/">
        <ArrowLeft aria-hidden="true" size={15} />
        Back to Feelow AI
      </Link>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true">
          F
        </div>
        <div className="login-heading">
          <span>Secure workspace access</span>
          <h1 id="login-title">Sign in to Feelow AI</h1>
          <p>
            Use your verified Google account to enter the customer
            feedback workspace.
          </p>
        </div>

        {accessDenied && (
          <div className="login-alert" role="alert">
            <LockKeyhole aria-hidden="true" size={17} />
            <div>
              <strong>Workspace access was not granted</strong>
              {access.status === "denied" && (
                <p>
                  Signed in as <strong>{access.email}</strong>. This Google
                  account is not on the workspace member list.
                </p>
              )}
              <p>
                Ask a workspace administrator to add your Google email to
                the member list, then try again.
              </p>
            </div>
          </div>
        )}

        {access.status === "denied" ? (
          <form action={signOutCurrentUser}>
            <button className="btn login-google" type="submit">
              Sign out and use another Google account
            </button>
          </form>
        ) : (
          <form action={signInWithGoogle}>
            <input name="callbackUrl" type="hidden" value={callbackUrl} />
            <button className="btn login-google" type="submit">
              <span className="google-mark" aria-hidden="true">
                G
              </span>
              Continue with Google
            </button>
          </form>
        )}

        <div className="login-trust">
          <ShieldCheck aria-hidden="true" size={17} />
          <p>
            Google verifies your identity. Feelow AI uses your workspace
            membership to determine organization and role.
          </p>
        </div>
      </section>
    </main>
  );
}
