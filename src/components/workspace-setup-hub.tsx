"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Check,
  Copy,
  GitBranch,
  PlugZap,
  Sparkles,
  Webhook,
} from "lucide-react";
import type { WorkspaceSetupStatus } from "@/lib/integration-repository";

function StepBadge({
  complete,
  number,
}: {
  complete: boolean;
  number: number;
}) {
  return (
    <span className={`setup-step-badge${complete ? " complete" : ""}`}>
      {complete ? <Check aria-hidden="true" size={14} /> : number}
    </span>
  );
}

async function setupFetch(
  path: string,
  orgId: string,
  method: "GET" | "POST" = "POST",
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Request failed",
    );
  }
  return payload;
}

export function WorkspaceSetupHub({
  orgId,
  initialStatus,
  firstName,
  organizationName,
  compact = false,
}: {
  orgId: string;
  initialStatus: WorkspaceSetupStatus;
  firstName: string;
  organizationName: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const completedSteps = [
    status.feedbackConnected,
    status.aiConfigured,
    status.githubConnected,
  ].filter(Boolean).length;

  const webhookUrl = status.webhook?.webhookUrl ?? null;

  async function sendTestEvent() {
    setBusy("test");
    setError(null);
    try {
      await setupFetch("/api/integrations/webhook/test", orgId);
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test event failed");
    } finally {
      setBusy(null);
    }
  }

  async function refreshStatus() {
    const next = await setupFetch("/api/integrations/setup", orgId, "GET");
    setStatus(next as WorkspaceSetupStatus);
    if ((next as WorkspaceSetupStatus).feedbackCount > 0) {
      router.refresh();
    }
  }

  async function connectWebhook() {
    setBusy("webhook");
    setError(null);
    try {
      const result = await setupFetch("/api/integrations/webhook", orgId);
      setWebhookSecret(result.signingSecret as string);
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook setup failed");
    } finally {
      setBusy(null);
    }
  }

  async function connectGithub() {
    setBusy("github");
    setError(null);
    try {
      const result = await setupFetch("/api/integrations/github", orgId);
      window.open(result.installUrl as string, "_blank", "noopener,noreferrer");
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GitHub setup failed");
    } finally {
      setBusy(null);
    }
  }

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className={`setup-hub${compact ? " setup-hub-compact" : ""}`}>
      {!compact && (
      <div className="setup-hub-intro">
        <div>
          <div className="eyebrow">{organizationName}</div>
          <h1>Welcome, {firstName}</h1>
          <p className="subtle">
            Connect your stack in three steps. CloseSpan will ingest feedback,
            run governed AI agents on your board, and prepare GitHub actions
            after approval.
          </p>
        </div>
        <div className="setup-progress-card">
          <strong>{completedSteps} of 3 connected</strong>
          <div className="setup-progress-bar" aria-hidden="true">
            <span style={{ width: `${(completedSteps / 3) * 100}%` }} />
          </div>
        </div>
      </div>
      )}

      {compact && (
        <div className="setup-hub-compact-head">
          <strong>Manual setup shortcuts</strong>
          <span className="subtle">{completedSteps} of 3 connected</span>
        </div>
      )}

      {error && (
        <div className="login-alert setup-alert" role="alert">
          <strong>Setup needs attention</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="setup-grid">
        <article className="card setup-card">
          <div className="setup-card-head">
            <StepBadge complete={status.feedbackConnected} number={1} />
            <div>
              <Webhook aria-hidden="true" size={18} />
              <h2>Connect your application</h2>
              <p className="subtle">
                Send customer feedback from any product with a signed webhook.
              </p>
            </div>
          </div>
          {status.feedbackConnected ? (
            <div className="setup-complete">
              <Check aria-hidden="true" size={16} />
              <span>
                {status.feedbackCount > 0
                  ? `${status.feedbackCount} feedback event${status.feedbackCount === 1 ? "" : "s"} received`
                  : "Webhook endpoint is live"}
              </span>
              <Link className="btn" href="/feedback">
                Open feedback inbox
              </Link>
            </div>
          ) : (
            <div className="setup-card-body">
              <p className="subtle">
                Fastest path: create a webhook endpoint, paste the URL into your
                app, and POST customer signals as they happen.
              </p>
              <button
                className="btn primary"
                type="button"
                disabled={busy === "webhook"}
                onClick={connectWebhook}
              >
                {busy === "webhook" ? "Creating endpoint..." : "Create webhook endpoint"}
              </button>
              {(webhookSecret || status.webhook) && webhookUrl && (
                <div className="setup-credentials">
                  <label>Webhook URL</label>
                  <div className="setup-copy-row">
                    <code>{webhookUrl}</code>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => copyValue("url", webhookUrl)}
                    >
                      <Copy size={14} />
                      {copied === "url" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {webhookSecret && (
                    <>
                      <label>Signing secret (shown once)</label>
                      <div className="setup-copy-row">
                        <code>{webhookSecret}</code>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => copyValue("secret", webhookSecret)}
                        >
                          <Copy size={14} />
                          {copied === "secret" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  )}
                  <button
                    className="btn"
                    type="button"
                    disabled={busy === "test" || (!webhookSecret && !status.webhook)}
                    onClick={sendTestEvent}
                  >
                    {busy === "test" ? "Sending test..." : "Send test feedback"}
                  </button>
                </div>
              )}
              <Link className="text-link" href="/integrations">
                Or browse Zendesk, Intercom, and Slack
              </Link>
            </div>
          )}
        </article>

        <article className="card setup-card">
          <div className="setup-card-head">
            <StepBadge complete={status.aiConfigured} number={2} />
            <div>
              <Sparkles aria-hidden="true" size={18} />
              <h2>Enable AI agents</h2>
              <p className="subtle">
                Agents classify feedback, cluster problems, and draft
                investigations on your board.
              </p>
            </div>
          </div>
          {status.aiConfigured ? (
            <div className="setup-complete">
              <Check aria-hidden="true" size={16} />
              <span>AI provider configured</span>
              <Link className="btn" href="/settings#ai">
                Review AI settings
              </Link>
            </div>
          ) : (
            <div className="setup-card-body">
              <p className="subtle">
                Add one provider key in Settings. CloseSpan encrypts it per
                workspace and uses it only for structured analysis.
              </p>
              <Link className="btn primary" href="/settings#ai">
                Configure AI provider
              </Link>
            </div>
          )}
        </article>

        <article className="card setup-card">
          <div className="setup-card-head">
            <StepBadge complete={status.githubConnected} number={3} />
            <div>
              <GitBranch aria-hidden="true" size={18} />
              <h2>Connect GitHub</h2>
              <p className="subtle">
                After human approval, CloseSpan can create issues and later open
                pull requests in allowed repositories.
              </p>
            </div>
          </div>
          {status.githubConnected ? (
            <div className="setup-complete">
              <Check aria-hidden="true" size={16} />
              <span>GitHub connected</span>
              <Link className="btn" href="/integrations">
                Manage GitHub scopes
              </Link>
            </div>
          ) : (
            <div className="setup-card-body">
              <p className="subtle">
                Install the CloseSpan GitHub App on the repositories you want
                agents to inspect and act on after approval.
              </p>
              <button
                className="btn primary"
                type="button"
                disabled={busy === "github"}
                onClick={connectGithub}
              >
                {busy === "github" ? "Opening GitHub..." : "Connect GitHub"}
              </button>
            </div>
          )}
        </article>
      </div>

      <section className="card setup-flow-note">
        <PlugZap aria-hidden="true" size={18} />
        <div>
          <strong>What happens after setup</strong>
          <p className="subtle">
            Feedback enters your inbox, AI agents populate the problem board,
            humans approve external actions, and GitHub receives the approved
            work. Deployments still run through your existing CI/CD pipeline.
          </p>
        </div>
      </section>
    </section>
  );
}
