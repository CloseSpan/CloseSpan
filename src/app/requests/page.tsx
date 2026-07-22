import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { ClosespanLogo } from "@/components/closespan-logo";
import { FeatureRequestsBoard } from "@/components/feature-requests-board";
import {
  listPendingFeatureRequests,
  listFeatureRequests,
  type FeatureRequestSubmission,
  type PublicFeatureRequest,
} from "@/lib/feature-request-repository";
import {
  featureRequestViewerHasher,
  isFeatureRequestModerator,
} from "@/lib/feature-request-security";
import { resolveWorkspaceAccess } from "@/lib/auth-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feature requests",
  description:
    "Explore the Closespan product roadmap, submit feature requests, and vote for the improvements that matter most to your team.",
  alternates: { canonical: "/requests" },
  robots: { index: true, follow: true },
};

export default async function FeatureRequestsPage() {
  const requestHeaders = await headers();
  let initialError: string | undefined;
  let requests: PublicFeatureRequest[] = [];
  let pendingRequests: FeatureRequestSubmission[] = [];
  let canModerate = false;
  try {
    requests = await listFeatureRequests(
      featureRequestViewerHasher(requestHeaders),
    );
  } catch (error) {
    console.error(
      "[feature-requests] Failed to load roadmap",
      error instanceof Error ? error.message : "Unknown error",
    );
    initialError = "The roadmap could not be loaded. Please try again shortly.";
  }
  try {
    const access = await resolveWorkspaceAccess();
    if (
      access.status === "granted" &&
      isFeatureRequestModerator(access.user.email, access.user.role)
    ) {
      canModerate = true;
      pendingRequests = await listPendingFeatureRequests();
    }
  } catch (error) {
    console.error(
      "[feature-requests] Failed to load moderator queue",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  return (
    <div className="feature-requests-page">
      <a className="skip-link" href="#requests-content">
        Skip to requests
      </a>
      <header className="feature-requests-header">
        <Link href="/" aria-label="Closespan home">
          <ClosespanLogo size="md" tone="inverse" />
        </Link>
        <Link href="/" className="feature-requests-home-link">
          <ArrowLeft aria-hidden="true" size={15} /> Home
        </Link>
      </header>
      <FeatureRequestsBoard
        initialRequests={requests}
        initialPendingRequests={pendingRequests}
        canModerate={canModerate}
        initialError={initialError}
      />
    </div>
  );
}
