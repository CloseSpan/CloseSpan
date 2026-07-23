import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleAlert, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import {
  signInWithGoogle,
  signOutCurrentUser,
} from "@/app/auth-actions";
import { CloseSpanLogo } from "@/components/closespan-logo";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to CloseSpan with Google.",
  robots: { index: false, follow: false },
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
  if (access.status === "denied") redirect("/waitlist");

  const workspaceUnavailable =
    access.status === "unavailable" ||
    params.error === "WorkspaceUnavailable";

  return (
    <main className="login-page">
      <Link className="login-back" href="/">
        <ArrowLeft aria-hidden="true" size={15} />
        Back to CloseSpan
      </Link>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <CloseSpanLogo size="lg" />
        </div>
        <div className="login-heading">
          <span>Continue with Google</span>
          <h1 id="login-title">Sign in to CloseSpan</h1>
          <p>
            Connect your Google account. Private beta access is currently
            limited, and everyone else can join the waitlist instantly.
          </p>
        </div>

        {workspaceUnavailable && (
          <div className="login-alert" role="alert">
            <CircleAlert aria-hidden="true" size={17} />
            <div>
              <strong>The owner workspace needs attention</strong>
              <p>
                Your Google account was verified, but CloseSpan could not load
                the private workspace. No action was executed. Please try
                again shortly.
              </p>
            </div>
          </div>
        )}

        {access.status === "unavailable" ? (
          <div className="login-denied-actions">
            <Link className="btn primary login-request-access" href="/overview">
              Try loading the workspace again
            </Link>
            <form action={signOutCurrentUser}>
              <button className="btn login-google" type="submit">
                Sign out and use another Google account
              </button>
            </form>
          </div>
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
            Google verifies your identity. CloseSpan never asks for your
            Google password.
          </p>
        </div>
      </section>
    </main>
  );
}
