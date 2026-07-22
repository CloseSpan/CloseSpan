import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import {
  signInWithGoogle,
  signOutCurrentUser,
} from "@/app/auth-actions";
import { ClosespanLogo } from "@/components/closespan-logo";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the Closespan workspace with Google.",
  robots: { index: false, follow: false },
};

const WORKSPACE_ADMIN_EMAIL = "shanmukhsain@gmail.com";

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

function accessRequestEmailUrl(email: string): string {
  const subject = "Closespan workspace access request";
  const body = [
    "Hi Shanmukh,",
    "",
    `Could you grant Closespan workspace access to ${email}?`,
    "",
    "What I want to use Closespan for:",
    "",
    "Thanks,",
  ].join("\n");
  return `mailto:${WORKSPACE_ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
        Back to Closespan
      </Link>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <ClosespanLogo size="lg" />
        </div>
        <div className="login-heading">
          <span>Secure workspace access</span>
          <h1 id="login-title">Sign in to Closespan</h1>
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
                  account is now on the access waitlist.
                </p>
              )}
              <p>
                Email the workspace administrator with a little context about
                how you want to use Closespan.
              </p>
            </div>
          </div>
        )}

        {access.status === "denied" ? (
          <div className="login-denied-actions">
            <a
              className="btn primary login-request-access"
              href={accessRequestEmailUrl(access.email)}
            >
              <Mail aria-hidden="true" size={17} />
              Email an access request
            </a>
            <p className="login-email-hint">
              Opens a message to {WORKSPACE_ADMIN_EMAIL} with your verified
              email and access question prefilled.
            </p>
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
            Google verifies your identity. Closespan uses your workspace
            membership to determine organization and role.
          </p>
        </div>
      </section>
    </main>
  );
}
