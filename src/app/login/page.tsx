import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import {
  signInWithGoogle,
  signOutCurrentUser,
} from "@/app/auth-actions";
import { AccessRequestEmail } from "@/components/access-request-email";
import { CloseSpanLogo } from "@/components/closespan-logo";
import { ensureWorkspaceAccessWaitlistEntry } from "@/lib/access-waitlist-repository";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the CloseSpan workspace with Google.",
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
  const subject = `CloseSpan workspace access request from ${email}`;
  const body = [
    "Hi Shanmukh,",
    "",
    `I tried to sign in to CloseSpan with ${email}.`,
    "",
    `Could you add ${email} to the appropriate CloseSpan workspace?`,
    "",
    "My question or intended use:",
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
  let waitlistRecorded = false;
  if (access.status === "denied") {
    try {
      waitlistRecorded = await ensureWorkspaceAccessWaitlistEntry(access.email);
    } catch (error) {
      console.error("Unable to confirm the workspace access waitlist entry", error);
    }
  }

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
          <span>Secure workspace access</span>
          <h1 id="login-title">Sign in to CloseSpan</h1>
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
                  Signed in as <strong>{access.email}</strong>.{" "}
                  {waitlistRecorded
                    ? "This Google account is now on the access waitlist."
                    : "The waitlist record could not be confirmed, so use the prefilled email below."}
                </p>
              )}
              <p>
                Email the workspace administrator with a little context about
                how you want to use CloseSpan.
              </p>
            </div>
          </div>
        )}

        {access.status === "denied" ? (
          <div className="login-denied-actions">
            <AccessRequestEmail
              adminEmail={WORKSPACE_ADMIN_EMAIL}
              email={access.email}
              mailtoUrl={accessRequestEmailUrl(access.email)}
            />
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
            Google verifies your identity. CloseSpan uses your workspace
            membership to determine organization and role.
          </p>
        </div>
      </section>
    </main>
  );
}
