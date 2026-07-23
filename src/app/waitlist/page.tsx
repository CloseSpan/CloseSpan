import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheckBig, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { signOutCurrentUser } from "@/app/auth-actions";
import { AccessRequestEmail } from "@/components/access-request-email";
import { CloseSpanLogo } from "@/components/closespan-logo";
import { ensureWorkspaceAccessWaitlistEntry } from "@/lib/access-waitlist-repository";
import { resolveWorkspaceAccess } from "@/lib/auth-user";
import {
  founderInquiryEmailUrl,
  PRIVATE_BETA_OWNER_EMAIL,
} from "@/lib/workspace-access-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Waitlist",
  description: "Your CloseSpan private beta waitlist status.",
  robots: { index: false, follow: false },
};

export default async function WaitlistPage() {
  const access = await resolveWorkspaceAccess();
  if (access.status === "unauthenticated") {
    redirect("/login?callbackUrl=/waitlist");
  }
  if (access.status === "granted") redirect("/overview");
  if (access.status === "unavailable") {
    redirect("/login?error=WorkspaceUnavailable");
  }

  let waitlistRecorded = false;
  try {
    waitlistRecorded = await ensureWorkspaceAccessWaitlistEntry(access.email);
  } catch (error) {
    console.error("Unable to confirm the workspace waitlist entry", error);
  }

  return (
    <main className="login-page waitlist-page">
      <Link className="login-back" href="/">
        <ArrowLeft aria-hidden="true" size={15} />
        Back to CloseSpan
      </Link>

      <section className="login-card waitlist-card" aria-labelledby="waitlist-title">
        <div className="login-brand">
          <CloseSpanLogo size="lg" />
        </div>
        <div className="login-heading">
          <span>Google account connected</span>
          <h1 id="waitlist-title">You&apos;re on the CloseSpan waitlist</h1>
          <p>
            Thanks for your interest. Private beta workspace access is limited
            to the founder while we prepare the product for more teams.
          </p>
        </div>

        <div className="waitlist-success" role="status">
          <CircleCheckBig aria-hidden="true" size={20} />
          <div>
            <strong>
              {waitlistRecorded
                ? "Successfully added to the waitlist"
                : "Your Google account is connected"}
            </strong>
            <p>{access.email}</p>
            {!waitlistRecorded && (
              <p>
                CloseSpan could not confirm the database record yet. Use the
                email button below so the founder can follow up directly.
              </p>
            )}
          </div>
        </div>

        <div className="login-denied-actions">
          <AccessRequestEmail
            adminEmail={PRIVATE_BETA_OWNER_EMAIL}
            mailtoUrl={founderInquiryEmailUrl(access.email)}
          />
          <form action={signOutCurrentUser}>
            <button className="btn login-google" type="submit">
              Sign out and use another Google account
            </button>
          </form>
        </div>

        <div className="login-trust">
          <ShieldCheck aria-hidden="true" size={17} />
          <p>
            Signing in does not grant access to the private workspace or its
            customer data.
          </p>
        </div>
      </section>
    </main>
  );
}
