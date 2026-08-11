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
  const [selectedRepositories, setSelectedRepositories] = useState(
    () => new Set(initialRepositories.filter((repository) => repository.workspaceSelected).map((repository) => repository.repository)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const activeInstallations = installations.filter((installation) => installation.active);
  const activeRepositories = repositories.filter((repository) => repository.active);

  async function connectRepository() {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        installUrl?: unknown;
      };
      if (!response.ok || typeof payload.installUrl !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "GitHub connection could not be started",
        );
      }
      window.location.assign(payload.installUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "GitHub connection could not be started",
      );
      setBusy(false);
    }
  }

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

  async function saveRepositorySelection(installationId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSelectionNotice(null);
    try {
      const selection = repositories
        .filter((repository) => repository.installationId === installationId && selectedRepositories.has(repository.repository))
        .map((repository) => repository.repository);
      const response = await fetch("/api/integrations/github/repositories", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ installationId, repositories: selection }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: unknown;
        repositories?: GithubRepositoryAuthorization[];
        repositoryCount?: number;
      };
      if (!response.ok || !payload.repositories) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Repository access could not be saved");
      }
      setRepositories(payload.repositories);
      setSelectedRepositories(new Set(payload.repositories.filter((repository) => repository.workspaceSelected).map((repository) => repository.repository)));
      setSelectionNotice(`${payload.repositoryCount ?? selection.length} repositories are authorized for this workspace.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Repository access could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card github-connection-panel" aria-labelledby="github-connection-title">
      <div className="github-connection-heading">
        <div className="github-connection-heading-copy">
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
        {activeInstallations.length === 0 && canManage && (
          <button
            className="btn primary github-connect-repository-button"
            type="button"
            disabled={busy}
            onClick={() => void connectRepository()}
          >
            <Github aria-hidden="true" size={16} />
            {busy ? "Opening GitHub…" : "Connect repository"}
          </button>
        )}
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
            <>
              <details className="github-repository-selector">
                <summary>Choose repositories for this workspace</summary>
                <div className="github-repository-selector-body">
                  <p className="subtle">A GitHub installation can serve multiple CloseSpan workspaces. Only repositories selected here can be profiled or used by this workspace.</p>
                  {activeInstallations.map((installation) => {
                    const installationRepositories = repositories.filter((repository) => repository.installationId === installation.installationId);
                    return (
                      <div className="github-repository-selection-group" key={installation.id}>
                        <strong>{installation.accountLogin}</strong>
                        {installationRepositories.map((repository) => {
                          const inaccessible = repository.workspaceSelected && !repository.active;
                          return (
                            <label className="toggle-row" key={repository.id}>
                              <div>
                                <strong>{repository.repository}</strong>
                                <p className="subtle">{inaccessible ? "No longer accessible in GitHub" : `Default branch ${repository.defaultBranch}`}</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={selectedRepositories.has(repository.repository)}
                                disabled={busy || inaccessible}
                                onChange={(event) => {
                                  setSelectedRepositories((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(repository.repository);
                                    else next.delete(repository.repository);
                                    return next;
                                  });
                                  setSelectionNotice(null);
                                }}
                              />
                            </label>
                          );
                        })}
                        <button className="btn primary" type="button" disabled={busy} onClick={() => saveRepositorySelection(installation.installationId)}>
                          {busy ? "Saving…" : "Save workspace access"}
                        </button>
                      </div>
                    );
                  })}
                  {selectionNotice && <p className="toast success" role="status">{selectionNotice}</p>}
                </div>
              </details>
              <button className="btn github-disconnect-button" type="button" disabled={busy} onClick={disconnect}>
                <Unplug aria-hidden="true" size={15} />
                {busy ? "Working..." : "Disconnect from this workspace"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
