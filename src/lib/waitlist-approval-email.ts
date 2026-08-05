interface CloudflareEmailResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: {
    delivered?: string[];
    queued?: string[];
    permanent_bounces?: string[];
  } | null;
}

export interface WaitlistApprovalEmailResult {
  configured: boolean;
  sent: boolean;
  error?: string;
}

function configuration() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from = process.env.WAITLIST_APPROVAL_EMAIL_FROM?.trim()
    || process.env.PROMPT_REVIEW_EMAIL_FROM?.trim();
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

export async function sendWaitlistApprovalEmail(
  user: { email: string; displayName: string | null },
  fetcher: typeof fetch = fetch,
): Promise<WaitlistApprovalEmailResult> {
  const configured = configuration();
  if (!configured) return { configured: false, sent: false, error: "Approval email is not configured" };
  const signInUrl = new URL("/login?callbackUrl=/overview", configured.appOrigin).toString();
  const name = user.displayName?.trim() || "there";
  const subject = "Your CloseSpan access is approved";
  const text = [`Hi ${name},`, "", "Your CloseSpan access has been approved and your workspace is ready.", `Sign in with this Google account: ${signInUrl}`, "", "Welcome to CloseSpan."].join("\n");
  const html = `<p>Hi ${escapeHtml(name)},</p><p>Your CloseSpan access has been approved and your workspace is ready.</p><p><a href="${escapeHtml(signInUrl)}">Sign in to CloseSpan</a></p><p>Please use this Google account: <strong>${escapeHtml(user.email)}</strong></p><p>Welcome to CloseSpan.</p>`;
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(configured.accountId)}/email/sending/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${configured.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: user.email,
        from: { address: configured.from, name: "CloseSpan" },
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as CloudflareEmailResponse | null;
    const error = payload?.errors?.map((item) => item.message).join("; ") || `Cloudflare Email Service returned HTTP ${response.status}`;
    if (!response.ok || !payload?.success) return { configured: true, sent: false, error };
    if (payload.result?.permanent_bounces?.length) return { configured: true, sent: false, error: "The approved email address permanently bounced" };
    if (!(payload.result?.delivered?.length || payload.result?.queued?.length))
      return { configured: true, sent: false, error: "Cloudflare did not accept the approval email" };
    return { configured: true, sent: true };
  } catch (error) {
    return { configured: true, sent: false, error: error instanceof Error ? error.message : "Approval email delivery failed" };
  }
}
