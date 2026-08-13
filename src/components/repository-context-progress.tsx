"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { RepositoryContextSnapshot } from "@/lib/repository-context-repository";

interface RepositoryContextResponse {
  provider: string;
  providerConfigured: boolean;
  contexts: RepositoryContextSnapshot[];
}

const ACTIVE_STATUSES = new Set([
  "Queued",
  "Discovering",
  "Uploading",
  "Indexing",
]);

function contextFetch(orgId: string): Promise<RepositoryContextResponse> {
  return fetch("/api/repository-contexts", {
    headers: {
      "x-org-id": orgId,
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
  }).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as Partial<RepositoryContextResponse>;
    if (!response.ok || !Array.isArray(payload.contexts)) {
      throw new Error("Repository context status is unavailable");
    }
    return payload as RepositoryContextResponse;
  });
}

function shortRepository(repository: string): string {
  return repository.split("/").at(-1) ?? repository;
}

function aggregateProgress(contexts: RepositoryContextSnapshot[]): number {
  if (!contexts.length) return 2;
  return Math.round(
    contexts.reduce((total, context) => total + context.progress, 0) / contexts.length,
  );
}

export function RepositoryContextProgress({ orgId }: { orgId: string }) {
  const [response, setResponse] = useState<RepositoryContextResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    try {
      setResponse(await contextFetch(orgId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await contextFetch(orgId);
        if (cancelled) return;
        setResponse(next);
        setLoadError(false);
        if (!initialized.current) {
          const queuedRepositories = next.contexts
            .filter((context) => context.status === "Queued")
            .map((context) => context.repository);
          if (!next.contexts.length || queuedRepositories.length) {
            initialized.current = true;
            const repositories = queuedRepositories.length
              ? queuedRepositories.map((repository) => ({ repository }))
              : [{}];
            await Promise.all(
              repositories.map((body) =>
                fetch("/api/repository-contexts", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-org-id": orgId,
                    "idempotency-key": crypto.randomUUID(),
                    "x-request-id": crypto.randomUUID(),
                  },
                  body: JSON.stringify(body),
                }),
              ),
            );
          }
        }
        if (!next.contexts.length || next.contexts.some((context) => ACTIVE_STATUSES.has(context.status))) {
          timer = window.setTimeout(poll, 1_500);
        }
      } catch {
        if (cancelled) return;
        setLoadError(true);
        timer = window.setTimeout(poll, 4_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orgId]);

  const contexts = useMemo(() => response?.contexts ?? [], [response]);
  const readyCount = contexts.filter((context) => context.status === "Ready").length;
  const failed = contexts.filter((context) => context.status === "Failed");
  const active = contexts.some((context) => ACTIVE_STATUSES.has(context.status));
  const complete = Boolean(contexts.length && readyCount === contexts.length);
  const progress = aggregateProgress(contexts);
  const indexedFiles = contexts.reduce((total, context) => total + context.indexedFiles, 0);
  const summary = useMemo(() => {
    if (loadError && !response) return "Reconnecting to repository context…";
    if (complete) {
      return `${readyCount} ${readyCount === 1 ? "repository" : "repositories"} understood · ${indexedFiles.toLocaleString()} source files indexed`;
    }
    if (failed.length && !active) return failed[0]?.errorMessage ?? "Repository context needs attention.";
    const current = contexts.find((context) => ACTIVE_STATUSES.has(context.status));
    return current?.stage ?? "Preparing authorized repositories for analysis";
  }, [active, complete, contexts, failed, indexedFiles, loadError, readyCount, response]);

  async function retry(repository: string) {
    setRetrying(repository);
    try {
      const result = await fetch("/api/repository-contexts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ repository }),
      });
      if (!result.ok) throw new Error("retry_failed");
      await load();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section
      className={`repository-context-progress${complete ? " is-ready" : ""}${failed.length && !active ? " has-error" : ""}`}
      aria-labelledby="repository-context-title"
      aria-live="polite"
    >
      <div className="repository-context-progress-head">
        <span className="repository-context-progress-icon" aria-hidden="true">
          {complete ? (
            <Check size={20} />
          ) : failed.length && !active ? (
            <CircleAlert size={20} />
          ) : (
            <BrainCircuit size={20} />
          )}
        </span>
        <div>
          <h2 id="repository-context-title">
            {complete
              ? "Repository context ready"
              : failed.length && !active
                ? "Repository context needs attention"
                : "Learning your repositories"}
          </h2>
          <p>{summary}</p>
        </div>
        {!complete && active && (
          <span className="repository-context-progress-value">{progress}%</span>
        )}
      </div>

      <div
        className="repository-context-progress-track"
        role="progressbar"
        aria-label="Repository context creation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={complete ? 100 : progress}
      >
        <span style={{ transform: `scaleX(${(complete ? 100 : progress) / 100})` }} />
      </div>

      {contexts.length > 1 && (
        <div className="repository-context-list" aria-label="Repository context status">
          {contexts.map((context) => (
            <div className="repository-context-row" key={context.id}>
              <span className="repository-context-row-state" aria-hidden="true">
                {context.status === "Ready" ? (
                  <Check size={14} />
                ) : context.status === "Failed" ? (
                  <CircleAlert size={14} />
                ) : (
                  <LoaderCircle className="spin" size={14} />
                )}
              </span>
              <span>{shortRepository(context.repository)}</span>
              <span>{context.status === "Ready" ? "Ready" : `${context.progress}%`}</span>
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && !active && (
        <div className="repository-context-actions">
          {failed.map((context) => (
            <button
              className="btn"
              type="button"
              key={context.id}
              disabled={retrying === context.repository || !response?.providerConfigured}
              onClick={() => void retry(context.repository)}
            >
              {retrying === context.repository ? (
                <LoaderCircle className="spin" size={14} aria-hidden="true" />
              ) : (
                <RotateCcw size={14} aria-hidden="true" />
              )}
              Retry {shortRepository(context.repository)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
