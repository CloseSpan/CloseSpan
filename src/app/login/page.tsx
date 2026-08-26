import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleAlert, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import {
  signInWithGoogle,
  signOutCurrentUser,
} from "@/app/auth-actions";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";
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
          <CloseSpan3DLogo decorative={false} priority size="lg" />
        </div>
        <div className="login-heading">
          <span>Continue with Google</span>
          <h1 id="login-title">Sign in to CloseSpan</h1>
          <p>
            Connect your Google account to create or open your private
            CloseSpan workspace.
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
                <svg viewBox="0 0 18 18" focusable="false">
                  <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.878 2.684-6.615Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.963 10.707A5.41 5.41 0 0 1 3.681 9c0-.593.102-1.169.282-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z" />
                  <path fill="#EA4335" d="M9 3.579c1.321 0 2.507.454 3.44 1.346l2.582-2.582C13.463.891 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.579 9 3.579Z" />
                </svg>
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
