import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeatureRequestsBoard } from "@/components/feature-requests-board";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listPendingFeatureRequests } from "@/lib/feature-request-repository";
import { isFeatureRequestModerator } from "@/lib/feature-request-security";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review feature requests",
  robots: { index: false, follow: false },
};

export default async function AdminRequestsPage() {
  const user = await requireWorkspaceUser();
  if (!isFeatureRequestModerator(user.email, user.role)) notFound();

  const pendingRequests = await listPendingFeatureRequests();

  return (
    <FeatureRequestsBoard
      initialRequests={[]}
      initialPendingRequests={pendingRequests}
      canModerate
      moderationOnly
      turnstileSiteKey=""
    />
  );
}
