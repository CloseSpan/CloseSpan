import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";
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
import {
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "Feature Requests and Product Roadmap | CloseSpan",
  },
  description:
    "Explore the CloseSpan product roadmap, submit feature requests, and vote for the customer feedback operations improvements that matter most to your team.",
  alternates: { canonical: "/requests" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Feature Requests and Product Roadmap | CloseSpan",
    description:
      "Explore the CloseSpan roadmap, submit feature requests, and vote for the improvements that matter most to your team.",
    url: `${SITE_URL}/requests`,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} feature requests and product roadmap`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Feature Requests and Product Roadmap | CloseSpan",
    description:
      "Explore the CloseSpan roadmap, submit feature requests, and vote for product improvements.",
    images: ["/opengraph-image"],
  },
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
        <Link href="/" aria-label="CloseSpan home">
          <CloseSpan3DLogo priority size="md" />
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
        turnstileSiteKey={turnstileSiteKey()}
      />
    </div>
  );
}
