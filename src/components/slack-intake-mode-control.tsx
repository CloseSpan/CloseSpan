"use client";

import { Bot, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";

export interface SlackIntakeModeStatus {
  intakeMode: "channel" | "mentions";
  botInstalled: boolean;
  botInstallAvailable: boolean;
}

export function SlackIntakeModeControl({
  orgId,
  initialStatus,
  onStatusChange,
}: {
  orgId: string;
  initialStatus: SlackIntakeModeStatus;
  onStatusChange?: (status: SlackIntakeModeStatus) => void;
}) {
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = initialStatus;
  const botEnabled = status.intakeMode === "mentions";

  async function updateMode(nextEnabled: boolean): Promise<void> {
    if (busy || nextEnabled === botEnabled) return;
    setBusy(true);
    setError(null);
    try {
      if (nextEnabled && !status.botInstalled) {
        const response = await fetch("/api/integrations/slack/install", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-org-id": orgId,
            "idempotency-key": crypto.randomUUID(),
            "x-request-id": crypto.randomUUID(),
          },
          body: "{}",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          installUrl?: string;
          error?: string;
        };
        if (!response.ok || !payload.installUrl) {
          throw new Error(
            payload.error || "The CloseSpan bot could not be installed right now.",
          );
        }
        window.location.assign(payload.installUrl);
        return;
      }

      const response = await fetch("/api/integrations/slack/mode", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ botEnabled: nextEnabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        slackIntake?: SlackIntakeModeStatus;
        error?: string;
      };
      if (!response.ok || !payload.slackIntake) {
        throw new Error(
          payload.error || "The Slack intake mode could not be changed.",
        );
      }
      onStatusChange?.(payload.slackIntake);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Slack intake mode could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="slack-intake-mode" aria-labelledby={`${descriptionId}-title`}>
      <div className="slack-intake-mode-heading">
        <span className="slack-intake-mode-icon" aria-hidden="true">
          <Bot size={17} />
        </span>
        <div>
          <strong id={`${descriptionId}-title`}>CloseSpan bot</strong>
          <span className={`badge ${botEnabled ? "success" : ""}`}>
            {botEnabled ? "On" : "Off"}
          </span>
        </div>
      </div>
      <label className="toggle-row slack-intake-mode-toggle">
        <span>
          <strong>{botEnabled ? "Mention-only intake" : "Channel monitoring"}</strong>
          <small id={descriptionId}>
            {botEnabled
              ? "Only conversations that mention @CloseSpan are considered, and every report requires confirmation."
              : "CloseSpan listens to the full channel, records clear feedback, and filters casual or irrelevant messages."}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Turn the CloseSpan Slack bot on or off"
          aria-describedby={descriptionId}
          checked={botEnabled}
          disabled={busy || (!status.botInstallAvailable && !status.botInstalled)}
          onChange={(event) => void updateMode(event.currentTarget.checked)}
        />
      </label>
      {!status.botInstalled && status.botInstallAvailable && (
        <p className="slack-intake-mode-note">
          Turning this on installs the CloseSpan app in this Slack workspace.
        </p>
      )}
      {!status.botInstallAvailable && !status.botInstalled && (
        <p className="integration-import failed" role="status">
          CloseSpan bot installation is not configured in this environment.
        </p>
      )}
      {busy && (
        <p className="integration-import" role="status">
          <LoaderCircle className="spin" size={13} aria-hidden="true" />
          {status.botInstalled ? "Updating Slack intake…" : "Opening Slack…"}
        </p>
      )}
      {error && (
        <p className="integration-import failed" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
