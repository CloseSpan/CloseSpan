import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

interface PromptReviewEmailRow {
  id: string;
  org_id: string;
  prompt_id: string;
  problem_id: string;
  reviewer_id: string;
  to_email: string;
  attempts: number;
  title: string;
  artifact_path: string;
  reviewer_name: string;
}

interface CloudflareEmailResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: {
    delivered?: string[];
    queued?: string[];
    permanent_bounces?: string[];
    message_id?: string;
  } | null;
}

export interface PromptReviewEmailDeliveryResult {
  configured: boolean;
  sent: number;
  retried: number;
  failed: number;
}

export interface CloudflareEmailConfiguration {
  accountId: string;
  apiToken: string;
  from: string;
  appOrigin: string;
}

export function cloudflarePromptEmailConfiguration(): CloudflareEmailConfiguration | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from = process.env.PROMPT_REVIEW_EMAIL_FROM?.trim();
  const originValue = process.env.AUTH_URL?.trim();
  if (!accountId || !apiToken || !from || !originValue) return null;
  try {
    const origin = new URL(originValue);
    if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") return null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) return null;
    return { accountId, apiToken, from, appOrigin: origin.origin };
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function claimEmail(client: PoolClient, orgId: string): Promise<PromptReviewEmailRow | null> {
  const result = await client.query<PromptReviewEmailRow>(
    `WITH candidate AS (
       SELECT outbox.id
         FROM prompt_review_email_outbox outbox
        WHERE outbox.org_id=$1 AND outbox.attempts<8
          AND (
            (outbox.status='Pending' AND outbox.next_attempt_at<=now())
            OR (outbox.status='Sending' AND outbox.updated_at<now()-interval '5 minutes')
          )
        ORDER BY outbox.next_attempt_at,outbox.created_at,outbox.id
        LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE prompt_review_email_outbox outbox
        SET status='Sending',attempts=outbox.attempts+1,updated_at=now()
       FROM candidate,implementation_prompts prompt,product_problems problem,workspace_members reviewer
      WHERE outbox.id=candidate.id
        AND prompt.org_id=outbox.org_id AND prompt.id=outbox.prompt_id
        AND problem.org_id=outbox.org_id AND problem.id=outbox.problem_id
        AND reviewer.org_id=outbox.org_id AND reviewer.id=outbox.reviewer_id
     RETURNING outbox.*,problem.title,prompt.artifact_path,reviewer.display_name AS reviewer_name`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

async function updateEmailStatus(
  id: string,
  status: "Pending" | "Sent" | "Failed",
  values: { error?: string; messageId?: string; retrySeconds?: number },
): Promise<void> {
  await databasePool().query(
    `UPDATE prompt_review_email_outbox SET status=$2,last_error=$3,
            provider_message_id=coalesce($4,provider_message_id),
            next_attempt_at=CASE WHEN $2='Pending' THEN now()+($5::int*interval '1 second') ELSE next_attempt_at END,
            sent_at=CASE WHEN $2='Sent' THEN now() ELSE sent_at END,updated_at=now()
      WHERE id=$1`,
    [id, status, values.error?.slice(0, 1_000) ?? null, values.messageId ?? null, values.retrySeconds ?? 0],
  );
}

async function sendEmail(
  email: PromptReviewEmailRow,
  configuration: CloudflareEmailConfiguration,
  fetcher: typeof fetch,
): Promise<{ status: "Sent" | "Pending" | "Failed"; error?: string; messageId?: string }> {
  const reviewUrl = new URL(`/problems/${encodeURIComponent(email.problem_id)}#engineering-ticket`, configuration.appOrigin).toString();
  const subject = `Review implementation prompt: ${email.title}`;
  const text = [
    `Hi ${email.reviewer_name},`,
    "",
    "CloseSpan created an implementation-prompt draft and assigned it to you for review.",
    `Problem: ${email.title}`,
    `Artifact: ${email.artifact_path}`,
    `Review: ${reviewUrl}`,
    "",
    "PDD testing and Tenki execution still require explicit approval.",
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(email.reviewer_name)},</p><p>CloseSpan created an implementation-prompt draft and assigned it to you for review.</p><p><strong>Problem:</strong> ${escapeHtml(email.title)}<br><strong>Artifact:</strong> <code>${escapeHtml(email.artifact_path)}</code></p><p><a href="${escapeHtml(reviewUrl)}">Review implementation prompt</a></p><p>PDD testing and Tenki execution still require explicit approval.</p>`;
  let response: Response;
  try {
    response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(configuration.accountId)}/email/sending/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: email.to_email,
        from: { address: configuration.from, name: "CloseSpan" },
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { status: "Pending", error: error instanceof Error ? error.message : "Cloudflare email request failed" };
  }
  const payload = await response.json().catch(() => null) as CloudflareEmailResponse | null;
  const error = payload?.errors?.map((item) => item.message).join("; ") || `Cloudflare Email Service returned HTTP ${response.status}`;
  if (response.status === 429 || response.status >= 500) return { status: "Pending", error };
  if (!response.ok || !payload?.success) return { status: "Failed", error };
  if (payload.result?.permanent_bounces?.length) return { status: "Failed", error: "The reviewer email address permanently bounced." };
  if (!(payload.result?.delivered?.length || payload.result?.queued?.length)) return { status: "Failed", error: "Cloudflare did not accept the reviewer email." };
  return { status: "Sent", messageId: payload.result.message_id };
}

export async function deliverPromptReviewEmails(
  orgId: string,
  options: { limit?: number; fetcher?: typeof fetch } = {},
): Promise<PromptReviewEmailDeliveryResult> {
  const configuration = cloudflarePromptEmailConfiguration();
  if (!configuration || workspacePersistenceMode(orgId) !== "postgres")
    return { configured: Boolean(configuration), sent: 0, retried: 0, failed: 0 };
  const result: PromptReviewEmailDeliveryResult = { configured: true, sent: 0, retried: 0, failed: 0 };
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  for (let index = 0; index < limit; index += 1) {
    const email = await transaction((client) => claimEmail(client, orgId));
    if (!email) break;
    const delivery = await sendEmail(email, configuration, options.fetcher ?? fetch);
    if (delivery.status === "Sent") {
      result.sent += 1;
      await updateEmailStatus(email.id, "Sent", { messageId: delivery.messageId });
    } else if (delivery.status === "Pending") {
      result.retried += 1;
      const retrySeconds = Math.min(60 * 2 ** Math.max(email.attempts - 1, 0), 3_600);
      await updateEmailStatus(email.id, "Pending", { error: delivery.error, retrySeconds });
    } else {
      result.failed += 1;
      await updateEmailStatus(email.id, "Failed", { error: delivery.error });
    }
  }
  return result;
}
