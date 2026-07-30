"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ExternalLink, Github, Unplug } from "lucide-react";
import type { GithubAppInstallationRecord } from "@/lib/github-installation-repository";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";

const errorMessages: Record<string, string> = {
  authentication_required: "Sign in again, then reconnect GitHub from this workspace.",
  administrator_required: "A workspace administrator must connect the GitHub App.",
  install_request_expired: "The installation request expired. Start Connect GitHub again.",
  installation_unavailable: "The installation is suspended, has no selected repositories, or is already connected elsewhere.",
  invalid_callback: "GitHub returned an invalid installation response. Start the connection again.",
  connection_failed: "CloseSpan could not verify the GitHub installation. Try connecting again.",
};

export function GithubConnectionPanel({
  orgId,
  installations: initialInstallations,
  repositories: initialRepositories,
  callbackStatus,
  callbackReason,
  canManage,
}: {
  orgId: string;
  installations: GithubAppInstallationRecord[];
  repositories: GithubRepositoryAuthorization[];
  callbackStatus: string | null;
  callbackReason: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [installations, setInstallations] = useState(initialInstallations);
  const [repositories, setRepositories] = useState(initialRepositories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeInstallations = installations.filter((installation) => installation.active);
  const activeRepositories = repositories.filter((repository) => repository.active);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/github", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok)
        throw new Error(typeof payload.error === "string" ? payload.error : "Disconnect failed");
      setInstallations((current) => current.map((item) => ({ ...item, active: false })));
      setRepositories((current) => current.map((item) => ({ ...item, active: false })));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card github-connection-panel" aria-labelledby="github-connection-title">
      <div className="github-connection-heading">
        <div className="github-connection-icon"><Github aria-hidden="true" size={22} /></div>
        <div>
          <div className="eyebrow">GitHub App</div>
          <h2 id="github-connection-title">
            {activeInstallations.length > 0 ? "GitHub connected" : "Connect GitHub repositories"}
          </h2>
          <p className="subtle">
            CloseSpan can work only in repositories explicitly selected during installation.
          </p>
        </div>
      </div>

      {callbackStatus === "connected" && (
        <div className="github-connection-message success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          Installation verified. {activeRepositories.length} repositor{activeRepositories.length === 1 ? "y is" : "ies are"} ready for approval-bound runs.
        </div>
      )}
      {callbackStatus === "error" && (
        <div className="github-connection-message error" role="alert">
          {errorMessages[callbackReason ?? ""] ?? errorMessages.connection_failed}
        </div>
      )}
      {error && <div className="github-connection-message error" role="alert">{error}</div>}

      {activeInstallations.length > 0 && (
        <>
          <div className="github-installation-summary">
            {activeInstallations.map((installation) => (
              <div key={installation.id} className="github-installation-account">
                <div>
                  <strong>{installation.accountLogin}</strong>
                  <span className="subtle">{installation.accountType} · {installation.repositorySelection} repositories</span>
                </div>
                <a className="btn" href={installation.settingsUrl} target="_blank" rel="noreferrer">
                  Manage on GitHub <ExternalLink aria-hidden="true" size={14} />
                </a>
              </div>
            ))}
          </div>
          <div className="github-repository-list" aria-label="Authorized GitHub repositories">
            {activeRepositories.map((repository) => (
              <div key={repository.id} className="github-repository-row">
                <span><CheckCircle2 aria-hidden="true" size={15} />{repository.repository}</span>
                <code>{repository.defaultBranch}</code>
              </div>
            ))}
          </div>
          {canManage && (
            <button className="btn github-disconnect-button" type="button" disabled={busy} onClick={disconnect}>
              <Unplug aria-hidden="true" size={15} />
              {busy ? "Disconnecting..." : "Disconnect from this workspace"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
