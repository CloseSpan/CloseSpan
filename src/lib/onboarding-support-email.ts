import { PUBLIC_EMAILS } from "./site";

interface CloudflareEmailResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: {
    delivered?: string[];
    queued?: string[];
    permanent_bounces?: string[];
  } | null;
}

export interface OnboardingSupportMessage {
  replyEmail: string;
  subject: string | null;
  message: string;
  organizationName: string;
  actorName: string;
  actorEmail: string;
}

export interface OnboardingSupportEmailResult {
  configured: boolean;
  sent: boolean;
  error?: string;
}

function configuration() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from =
    process.env.SUPPORT_EMAIL_FROM?.trim() ||
    process.env.PROMPT_REVIEW_EMAIL_FROM?.trim();
  if (!accountId || !apiToken || !from) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) return null;
  return { accountId, apiToken, from };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendOnboardingSupportEmail(
  input: OnboardingSupportMessage,
  fetcher: typeof fetch = fetch,
): Promise<OnboardingSupportEmailResult> {
  const configured = configuration();
  if (!configured) {
    return {
      configured: false,
      sent: false,
      error: "Support email is not configured",
    };
  }

  const requestedSubject = input.subject?.replace(/[\r\n]+/g, " ").trim();
  const subject = requestedSubject
    ? `[CloseSpan onboarding] ${requestedSubject}`
    : `[CloseSpan onboarding] ${input.organizationName}`;
  const text = [
    `Workspace: ${input.organizationName}`,
    `Submitted by: ${input.actorName} <${input.actorEmail}>`,
    `Reply to: ${input.replyEmail}`,
    "",
    input.message,
  ].join("\n");
  const html = [
    `<p><strong>Workspace:</strong> ${escapeHtml(input.organizationName)}<br>`,
    `<strong>Submitted by:</strong> ${escapeHtml(input.actorName)} &lt;${escapeHtml(input.actorEmail)}&gt;<br>`,
    `<strong>Reply to:</strong> ${escapeHtml(input.replyEmail)}</p>`,
    `<p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>`,
  ].join("");

  try {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(configured.accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configured.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: PUBLIC_EMAILS.support,
          from: { address: configured.from, name: "CloseSpan Onboarding" },
          reply_to: input.replyEmail,
          subject,
          text,
          html,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | CloudflareEmailResponse
      | null;
    const error =
      payload?.errors?.map((item) => item.message).join("; ") ||
      `Cloudflare Email Service returned HTTP ${response.status}`;
    if (!response.ok || !payload?.success) {
      return { configured: true, sent: false, error };
    }
    if (payload.result?.permanent_bounces?.length) {
      return {
        configured: true,
        sent: false,
        error: "The support email permanently bounced",
      };
    }
    if (!(payload.result?.delivered?.length || payload.result?.queued?.length)) {
      return {
        configured: true,
        sent: false,
        error: "Cloudflare did not accept the support email",
      };
    }
    return { configured: true, sent: true };
  } catch (error) {
    return {
      configured: true,
      sent: false,
      error:
        error instanceof Error
          ? error.message
          : "Support email delivery failed",
    };
  }
}
