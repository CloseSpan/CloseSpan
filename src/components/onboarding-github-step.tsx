"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Github, LoaderCircle } from "lucide-react";
import { CustomSelect } from "@/components/custom-select";
import { startGithubInstallationPopup } from "@/lib/github-installation-client";
import type { GithubAppInstallationRecord } from "@/lib/github-installation-repository";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";

export interface GithubConnectionChoice {
  installationId: string;
  accountLogin: string;
  reusable: boolean;
  repositories: Array<{ repository: string; defaultBranch: string; selected: boolean }>;
}

interface ReusableInstallation {
  installationId: string;
  accountLogin: string;
  repositories: Array<{ repository: string; defaultBranch: string }>;
}

export function buildGithubConnectionChoices(
  installations: GithubAppInstallationRecord[],
  repositories: GithubRepositoryAuthorization[],
  reusable: ReusableInstallation[],
): GithubConnectionChoice[] {
  const choices: GithubConnectionChoice[] = installations
    .filter((installation) => installation.active)
    .map((installation) => ({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      reusable: false,
      repositories: repositories
        .filter((repository) => repository.active && repository.installationId === installation.installationId)
        .map((repository) => ({
          repository: repository.repository,
          defaultBranch: repository.defaultBranch,
          selected: repository.workspaceSelected,
        })),
    }));
  for (const installation of reusable) {
    if (choices.some((choice) => choice.installationId === installation.installationId)) continue;
    choices.push({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      reusable: true,
      // Reusing a connection never inherits another workspace's repository access.
      repositories: installation.repositories.map((repository) => ({ ...repository, selected: false })),
    });
  }
  return choices;
}

export function OnboardingGithubPicker({
  choices, installationId, selected, query, loading, busy, error, canManage,
  onAccountChange, onSelectionChange, onQueryChange, onSave, onConnect, onRetry,
  onCancel, onContinue, continuing,
}: {
  choices: GithubConnectionChoice[];
  installationId: string;
  selected: ReadonlySet<string>;
  query: string;
  loading: boolean;
  busy: "connect" | "save" | null;
  error: string | null;
  canManage: boolean;
  continuing: boolean;
  onAccountChange: (value: string) => void;
  onSelectionChange: (repository: string, checked: boolean) => void;
  onQueryChange: (value: string) => void;
  onSave: () => void;
  onConnect: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const connection = choices.find((choice) => choice.installationId === installationId);
  const filtered = connection?.repositories.filter((repository) =>
    repository.repository.toLowerCase().includes(query.trim().toLowerCase()),
  ) ?? [];
  const disabled = Boolean(busy) || continuing || loading;
  const hasSelection = connection?.repositories.some((repository) => selected.has(repository.repository)) ?? false;
  return (
    <section className="card onboarding-github-step" aria-labelledby="onboarding-github-title" aria-busy={loading}>
      <header className="onboarding-github-heading">
        <div className="onboarding-github-title">
          <Github size={24} aria-hidden="true" />
          <h2 id="onboarding-github-title">{loading ? "Checking GitHub…" : choices.length ? "Choose repositories" : "Connect GitHub"}</h2>
        </div>
        {!loading && choices.length > 0 && <span className="badge success">GitHub connected</span>}
      </header>
      {loading && <p className="subtle" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading repositories…</p>}
      {error && <div className="onboarding-github-error" role="alert"><p>{error}</p><button type="button" className="btn" disabled={disabled} onClick={onRetry}>Try again</button></div>}
      {!loading && !canManage && <p className="subtle">Ask a workspace admin to choose repositories.</p>}
      {!loading && canManage && connection && (
        <div className="onboarding-github-picker">
          {choices.length > 1 ? (
            <CustomSelect ariaLabel="GitHub account" value={installationId} disabled={disabled}
              options={choices.map((choice) => ({ value: choice.installationId, label: choice.accountLogin }))}
              onValueChange={onAccountChange} />
          ) : <p className="onboarding-github-account">{connection.accountLogin}</p>}
          {connection.repositories.length > 5 && (
            <input type="search" className="input" aria-label="Find a repository" placeholder="Find a repository…"
              value={query} disabled={disabled} onChange={(event) => onQueryChange(event.target.value)} />
          )}
          {connection.repositories.length === 0 ? <p className="subtle">No repositories available. Update repository access in GitHub.</p> : (
            <fieldset className="onboarding-github-repositories" disabled={disabled}>
              <legend className="sr-only">Repositories for this workspace</legend>
              {filtered.map((repository) => (
                <label className="onboarding-github-repository" key={repository.repository}>
                  <input type="checkbox" checked={selected.has(repository.repository)}
                    onChange={(event) => onSelectionChange(repository.repository, event.target.checked)} />
                  <span>{repository.repository}</span>
                </label>
              ))}
              {filtered.length === 0 && <p className="subtle">No matching repositories.</p>}
            </fieldset>
          )}
        </div>
      )}
      <footer className="onboarding-github-actions">
        {canManage && !loading && connection && (
          <button type="button" className="btn primary" disabled={disabled || !hasSelection} onClick={onSave}>
            {busy === "save" ? "Connecting…" : "Use selected repositories"}
          </button>
        )}
        {canManage && !loading && (
          <button type="button" className={`btn${connection ? "" : " primary"}`} disabled={disabled} onClick={onConnect}>
            {busy === "connect" ? "Connecting in popup…" : connection ? "Manage GitHub access" : "Connect GitHub"}
          </button>
        )}
        {busy === "connect" && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button type="button" className="text-link" disabled={disabled} onClick={onContinue}>
          {continuing ? "Opening workspace…" : "Continue to workspace"}
        </button>
      </footer>
    </section>
  );
}

async function githubFetch<T>(orgId: string, path: string, options: { method?: "POST" | "PUT"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    cache: "no-store",
    signal: options.signal,
    headers: {
      "x-org-id": orgId,
      ...(options.method ? { "Content-Type": "application/json", "idempotency-key": crypto.randomUUID(), "x-request-id": crypto.randomUUID() } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "GitHub could not be loaded. Try again.");
  return payload as T;
}

export function OnboardingGithubStep({ orgId, canManage, onConnectionChange, onContinue, continuing }: {
  orgId: string;
  canManage: boolean;
  onConnectionChange: () => Promise<void>;
  onContinue: () => void;
  continuing: boolean;
}) {
  const [choices, setChoices] = useState<GithubConnectionChoice[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const [current, reusable] = await Promise.all([
        githubFetch<{ installations: GithubAppInstallationRecord[]; repositories: GithubRepositoryAuthorization[] }>(orgId, "/api/integrations/github", { signal }),
        canManage ? githubFetch<{ installations: ReusableInstallation[] }>(orgId, "/api/integrations/github/reusable", { signal }) : Promise.resolve({ installations: [] }),
      ]);
      if (signal.aborted) return;
      const next = buildGithubConnectionChoices(current.installations, current.repositories, reusable.installations);
      setChoices(next);
      setInstallationId(next[0]?.installationId ?? "");
      setSelected(new Set(next[0]?.repositories.filter((repository) => repository.selected).map((repository) => repository.repository)));
      setQuery("");
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof Error ? caught.message : "GitHub could not be loaded. Try again.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [orgId, canManage]);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => pending.current?.abort();
  }, [load]);

  function retry() {
    setLoading(true);
    setError(null);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    void load(controller.signal);
  }

  async function connect() {
    if (busy || !canManage) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("connect");
    setError(null);
    try {
      await startGithubInstallationPopup(orgId, { returnTo: "/onboarding", signal: controller.signal });
      if (controller.signal.aborted) return;
      setLoading(true);
      await load(controller.signal);
      if (!controller.signal.aborted) await onConnectionChange();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "GitHub connection failed.");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function save() {
    const connection = choices.find((choice) => choice.installationId === installationId);
    const selection = connection?.repositories.filter((repository) => selected.has(repository.repository)).map((repository) => repository.repository) ?? [];
    if (busy || !canManage || !connection || selection.length === 0) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("save");
    setError(null);
    try {
      if (connection.reusable) {
        await githubFetch(orgId, "/api/integrations/github/reusable", { method: "POST", body: { installationId }, signal: controller.signal });
        if (controller.signal.aborted) return;
        // If selection fails, retry it without attempting to link the connection again.
        setChoices((current) => current.map((choice) => choice.installationId === installationId ? { ...choice, reusable: false } : choice));
      }
      await githubFetch(orgId, "/api/integrations/github/repositories", {
        method: "PUT", body: { installationId, repositories: selection }, signal: controller.signal,
      });
      if (!controller.signal.aborted) await onConnectionChange();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Repository selection could not be saved.");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return <OnboardingGithubPicker choices={choices} installationId={installationId} selected={selected} query={query}
    loading={loading} busy={busy} error={error} canManage={canManage} continuing={continuing}
    onAccountChange={(value) => {
      setInstallationId(value);
      setSelected(new Set(choices.find((choice) => choice.installationId === value)?.repositories.filter((repository) => repository.selected).map((repository) => repository.repository)));
      setQuery("");
    }}
    onSelectionChange={(repository, checked) => setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(repository); else next.delete(repository);
      return next;
    })}
    onQueryChange={setQuery} onSave={() => void save()} onConnect={() => void connect()} onRetry={retry}
    onCancel={() => { pending.current?.abort(); setBusy(null); setLoading(false); }} onContinue={onContinue} />;
}
