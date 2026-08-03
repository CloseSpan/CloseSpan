import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface PromptReviewNotificationView {
  id: string;
  problemId: string;
  promptId: string;
  title: string;
  artifactPath: string;
  status: "Unread" | "Read";
  createdAt: string;
  readAt: string | null;
}

const memoryNotifications = new Map<string, PromptReviewNotificationView[]>();

export function createMemoryPromptReviewNotification(input: {
  orgId: string;
  reviewerId: string;
  notification: PromptReviewNotificationView;
}): void {
  const key = `${input.orgId}:${input.reviewerId}`;
  const current = memoryNotifications.get(key) ?? [];
  if (!current.some((item) => item.id === input.notification.id))
    memoryNotifications.set(key, [structuredClone(input.notification), ...current]);
}

export async function listPromptReviewNotifications(
  orgId: string,
  reviewerId: string,
): Promise<PromptReviewNotificationView[]> {
  if (workspacePersistenceMode(orgId) === "memory")
    return structuredClone(memoryNotifications.get(`${orgId}:${reviewerId}`) ?? []);
  const result = await databasePool().query<{
    id: string;
    problem_id: string;
    prompt_id: string;
    title: string;
    artifact_path: string;
    status: "Unread" | "Read";
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT notification.id,notification.problem_id,notification.prompt_id,
            problem.title,prompt.artifact_path,notification.status,
            notification.created_at,notification.read_at
       FROM prompt_review_notifications notification
       JOIN product_problems problem
         ON problem.org_id=notification.org_id AND problem.id=notification.problem_id
       JOIN implementation_prompts prompt
         ON prompt.org_id=notification.org_id AND prompt.id=notification.prompt_id
      WHERE notification.org_id=$1 AND notification.reviewer_id=$2
      ORDER BY (notification.status='Unread') DESC,notification.created_at DESC
      LIMIT 100`,
    [orgId, reviewerId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    problemId: row.problem_id,
    promptId: row.prompt_id,
    title: row.title,
    artifactPath: row.artifact_path,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  }));
}

export async function unreadPromptReviewNotificationCount(
  orgId: string,
  reviewerId: string,
): Promise<number> {
  if (workspacePersistenceMode(orgId) === "memory")
    return (memoryNotifications.get(`${orgId}:${reviewerId}`) ?? []).filter((item) => item.status === "Unread").length;
  const result = await databasePool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM prompt_review_notifications
      WHERE org_id=$1 AND reviewer_id=$2 AND status='Unread'`,
    [orgId, reviewerId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function markPromptReviewNotificationRead(
  orgId: string,
  reviewerId: string,
  notificationId: string,
): Promise<boolean> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryNotifications.get(`${orgId}:${reviewerId}`) ?? [];
    const notification = current.find((item) => item.id === notificationId);
    if (!notification) return false;
    notification.status = "Read";
    notification.readAt ??= new Date().toISOString();
    return true;
  }
  const result = await databasePool().query(
    `UPDATE prompt_review_notifications SET status='Read',read_at=coalesce(read_at,now())
      WHERE org_id=$1 AND reviewer_id=$2 AND id=$3`,
    [orgId, reviewerId, notificationId],
  );
  return result.rowCount === 1;
}
