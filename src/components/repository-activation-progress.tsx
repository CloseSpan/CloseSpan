"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { TenkiRunnerWorkflowSetupView } from "@/lib/tenki-runner-workflow-setup-repository";
import type { TenkiRunnerSizingProbe } from "@/lib/tenki-runner-sizing-probe-repository";

interface RepositoryActivationItem {
  repository: string;
  defaultBranch: string;
  profileDetected: boolean;
  executionReady: boolean;
  tenkiRequired: boolean;
  setup: TenkiRunnerWorkflowSetupView | null;
  sizingProbes: TenkiRunnerSizingProbe[];
}

interface RepositoryActivationResponse {
  repositories: RepositoryActivationItem[];
}

function shortRepository(repository: string): string {
  return repository.split("/").at(-1) ?? repository;
}

function requestHeaders(orgId: string, mutation = false): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-org-id": orgId,
    "x-request-id": crypto.randomUUID(),
    ...(mutation ? { "idempotency-key": crypto.randomUUID() } : {}),
  };
}

async function activationFetch(orgId: string): Promise<RepositoryActivationResponse> {
  const response = await fetch("/api/onboarding/repository-activation", {
    headers: requestHeaders(orgId),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Partial<RepositoryActivationResponse>;
  if (!response.ok || !Array.isArray(payload.repositories)) {
    throw new Error("Repository execution status is unavailable");
  }
  return payload as RepositoryActivationResponse;
}

function itemState(item: RepositoryActivationItem):
  | "detecting"
  | "preparing"
  | "approval"
  | "probing"
  | "activating"
  | "ready"
  | "failed" {
  const sizingProbes = item.sizingProbes ?? [];
  if (item.setup?.status === "Failed") return "failed";
  if (sizingProbes.some((probe) => probe.status === "Failed")) return "failed";
  if (item.setup?.status === "Pending") return "approval";
  if (!item.profileDetected) return "detecting";
  if (item.tenkiRequired && !item.setup) return "preparing";
  if (item.setup?.status === "Preparing") return "preparing";
  if (
    item.tenkiRequired
    && !item.executionReady
    && item.setup?.status === "Installed"
    && (
      sizingProbes.length === 0
      || sizingProbes.some((probe) => ["Queued", "Dispatched", "Running"].includes(probe.status))
    )
  ) return "probing";
  if (
    item.tenkiRequired
    && !item.executionReady
    && sizingProbes.some((probe) => probe.status === "Completed" && probe.telemetry?.exitCode !== 0)
  ) return "failed";
  if (!item.executionReady) return "activating";
  return "ready";
}

function stateLabel(state: ReturnType<typeof itemState>): string {
  if (state === "detecting") return "Detecting configuration";
  if (state === "preparing") return "Preparing setup";
  if (state === "approval") return "Approval needed";
  if (state === "probing") return "Measuring runner workload";
  if (state === "activating") return "Activating execution";
  if (state === "failed") return "Needs attention";
  return "Ready";
}

export function RepositoryActivationProgress({ orgId }: { orgId: string }) {
  const [response, setResponse] = useState<RepositoryActivationResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyRepository, setBusyRepository] = useState<string | null>(null);
  const autoFinalizeAttempted = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setResponse(await activationFetch(orgId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [orgId]);

  const repositories = useMemo(() => response?.repositories ?? [], [response]);
  const states = repositories.map(itemState);
  const complete = repositories.length > 0 && states.every((state) => state === "ready");
  const pendingApproval = states.includes("approval");
  const failed = states.includes("failed");

  const prepare = useCallback(async (repository: string) => {
    setBusyRepository(repository);
    setActionError(null);
    try {
      const result = await fetch(
        "/api/onboarding/repository-activation",
        {
          method: "POST",
          headers: requestHeaders(orgId, true),
          body: JSON.stringify({ repository }),
        },
      );
      const payload = await result.json().catch(() => ({})) as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? "Repository setup could not be prepared");
      await load();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Repository setup could not be prepared",
      );
    } finally {
      setBusyRepository(null);
    }
  }, [load, orgId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await activationFetch(orgId);
        if (cancelled) return;
        setResponse(next);
        setLoadError(false);
        const unfinishedInstalled = next.repositories.find((repository) =>
          !repository.executionReady
          && repository.profileDetected
          && repository.setup?.status !== "Pending"
          && repository.setup?.status !== "Failed"
          && !autoFinalizeAttempted.current.has(repository.repository)
        );
        if (unfinishedInstalled) {
          autoFinalizeAttempted.current.add(unfinishedInstalled.repository);
          void prepare(unfinishedInstalled.repository);
        }
        if (next.repositories.some((repository) => itemState(repository) !== "ready")) {
          timer = window.setTimeout(poll, 2_500);
        }
      } catch {
        if (cancelled) return;
        setLoadError(true);
        timer = window.setTimeout(poll, 5_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orgId, prepare]);

  async function approve(item: RepositoryActivationItem) {
    if (!item.setup?.pullRequestNumber) return;
    setBusyRepository(item.repository);
    setActionError(null);
    try {
      const result = await fetch(
        "/api/settings/execution-profiles/approve-runner-workflow",
        {
          method: "POST",
          headers: requestHeaders(orgId, true),
          body: JSON.stringify({
            repository: item.repository,
            pullRequestNumber: item.setup.pullRequestNumber,
          }),
        },
      );
      const payload = await result.json().catch(() => ({})) as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? "The setup pull request could not be merged");
      autoFinalizeAttempted.current.delete(item.repository);
      await load();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The setup pull request could not be merged",
      );
    } finally {
      setBusyRepository(null);
    }
  }

  if (response && repositories.length === 0) return null;

  const title = complete
    ? "Repository execution ready"
    : failed
      ? "Repository execution needs attention"
      : pendingApproval
        ? "Approve repository execution"
        : "Preparing repository execution";
  const description = complete
    ? "Runtime verification and approved Prompt Testing execution are enabled."
    : failed
      ? "CloseSpan could not finish one repository automatically. Retry after resolving the reported access or configuration issue."
      : pendingApproval
        ? "CloseSpan prepared the reviewed Tenki workflows. Approve the merge to enable runtime verification and approved coding runs."
        : loadError && !response
          ? "Reconnecting to background setup…"
        : "Configuration detection, runner sizing, and workflow preparation are running alongside repository indexing.";

  return (
    <section
      className={`repository-activation-progress${complete ? " is-ready" : ""}${failed ? " has-error" : ""}${pendingApproval ? " needs-approval" : ""}`}
      aria-labelledby="repository-activation-title"
      aria-live="polite"
    >
      <div className="repository-activation-head">
        <span className="repository-activation-icon" aria-hidden="true">
          {complete ? <Check size={20} /> : failed ? <CircleAlert size={20} /> : pendingApproval ? <GitPullRequest size={20} /> : <LoaderCircle className="spin" size={20} />}
        </span>
        <div>
          <h2 id="repository-activation-title">{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {repositories.length > 0 && (
        <div className="repository-activation-list" aria-label="Repository execution setup">
          {repositories.map((item) => {
            const state = itemState(item);
            const busy = busyRepository === item.repository;
            return (
              <div className="repository-activation-row" key={item.repository}>
                <div className="repository-activation-repository">
                  <strong>{shortRepository(item.repository)}</strong>
                  <span>{stateLabel(state)}</span>
                </div>
                {state === "approval" && item.setup && (
                  <div className="repository-activation-actions">
                    {item.setup.pullRequestUrl && (
                      <a className="btn subtle" href={item.setup.pullRequestUrl} target="_blank" rel="noreferrer">
                        Review pull request
                        <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    )}
                    <button className="btn primary" type="button" disabled={busy} onClick={() => void approve(item)}>
                      {busy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <GitMerge size={16} aria-hidden="true" />}
                      {busy ? "Approving and merging…" : "Approve and merge setup"}
                    </button>
                  </div>
                )}
                {state === "failed" && (
                  <div className="repository-activation-recovery">
                    {(item.setup?.failureMessage || item.sizingProbes?.find((probe) => probe.status === "Failed")?.failureMessage) && (
                      <p>{item.setup?.failureMessage || item.sizingProbes?.find((probe) => probe.status === "Failed")?.failureMessage}</p>
                    )}
                    <button className="btn" type="button" disabled={busy} onClick={() => void prepare(item.repository)}>
                      {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
                      {busy ? "Retrying…" : "Retry setup"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {actionError && (
        <p className="repository-activation-action-error" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}
