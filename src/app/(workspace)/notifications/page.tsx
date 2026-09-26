import { PromptReviewNotifications } from "@/components/prompt-review-notifications";
import { PageTitle } from "@/components/screens";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { listPromptReviewNotifications } from "@/lib/prompt-review-notification-repository";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireWorkspaceUser();
  const notifications = await listPromptReviewNotifications(user.orgId, user.id);
  return (
    <>
      <PageTitle title="Notifications"  />
      <PromptReviewNotifications orgId={user.orgId} initialNotifications={notifications} />
    </>
  );
}
