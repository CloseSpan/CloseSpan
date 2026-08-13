"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { ExecutionProfileVersion } from "@/lib/execution-profile";
import type { ProblemRepositoryMatchReviewResponse } from "@/lib/problem-repository-match-review";

interface ProfileChoice {
  profile: ExecutionProfileVersion;
  state: "active" | "detected";
}

function requestHeaders(orgId: string, mutation = false): HeadersInit {
  return {
    "x-org-id": orgId,
    "x-request-id": crypto.randomUUID(),
    ...(mutation
      ? {
          "content-type": "application/json",
          "idempotency-key": `repository_match_${crypto.randomUUID().replaceAll("-", "")}`,
        }
      : {}),
  };
}

function compactHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function RepositoryMatchReview({
  orgId,
  problemId,
  onPddProfileReady,
}: {
  orgId: string;
  problemId: string;
  onPddProfileReady?: (ready: boolean) => void;
}) {
  const [view, setView] = useState<ProblemRepositoryMatchReviewResponse>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"refresh" | "confirm" | "reject">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [repositorySelection, setRepository] = useState("");
  const [workspaceRootSelection, setWorkspaceRoot] = useState("");
  const [profileSelection, setProfileId] = useState("");

  async function load(): Promise<void> {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/problems/${encodeURIComponent(problemId)}/repository-match`,
        { headers: requestHeaders(orgId), cache: "no-store" },
      );
      const payload = await response.json() as ProblemRepositoryMatchReviewResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Repository review could not be loaded.");
      }
      setView(payload);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Repository review could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Loading is an external synchronization; retries call the same helper
    // from an event handler.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // `problemId` and `orgId` fully identify this review surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, problemId]);

  useEffect(() => {
    onPddProfileReady?.(Boolean(view?.pddProfileReady));
  }, [onPddProfileReady, view?.pddProfileReady]);

  const repositoryNames = useMemo(
    () => view?.repositories.map((item) => item.repository) ?? [],
    [view?.repositories],
  );

  const preferredMatch = view?.confirmedMatch
    ?? view?.matches.find((match) => match.status === "Suggested");
  const repository = repositoryNames.includes(repositorySelection)
    ? repositorySelection
    : preferredMatch && repositoryNames.includes(preferredMatch.repository)
      ? preferredMatch.repository
      : repositoryNames[0] ?? "";

  const assignments = useMemo(
    () => (view?.assignments ?? []).filter(
      (assignment) => assignment.repository === repository,
    ),
    [repository, view?.assignments],
  );
  const roots = useMemo(
    () => [...new Set(assignments.map((assignment) => assignment.workspaceRoot))],
    [assignments],
  );

  const preferredRoot = view?.confirmedMatch?.repository === repository
    ? view.confirmedMatch.workspaceRoot
    : view?.matches.find(
        (match) =>
          match.repository === repository && match.status === "Suggested",
      )?.workspaceRoot;
  const workspaceRoot = roots.includes(workspaceRootSelection)
    ? workspaceRootSelection
    : preferredRoot && roots.includes(preferredRoot)
      ? preferredRoot
      : roots[0] ?? "";

  const profileChoices = useMemo(() => {
    const assignment = assignments.find(
      (candidate) => candidate.workspaceRoot === workspaceRoot,
    );
    if (!assignment) return [];
    return [
      ...(assignment.activeProfile
        ? [{ profile: assignment.activeProfile, state: "active" as const }]
        : []),
      ...(assignment.detectedProfile
        ? [{ profile: assignment.detectedProfile, state: "detected" as const }]
        : []),
    ];
  }, [assignments, workspaceRoot]);
  const preferredProfile = view?.confirmedMatch?.repository === repository &&
    view.confirmedMatch.workspaceRoot === workspaceRoot
    ? view.confirmedMatch.profileId
    : view?.matches.find(
        (match) =>
          match.repository === repository &&
          match.workspaceRoot === workspaceRoot &&
          match.status === "Suggested",
      )?.profileId;
  const profileId = profileChoices.some(
    (choice) => choice.profile.id === profileSelection,
  )
    ? profileSelection
    : preferredProfile && profileChoices.some(
        (choice) => choice.profile.id === preferredProfile,
      )
      ? preferredProfile
      : profileChoices.find((choice) => choice.state === "active")?.profile.id
        ?? profileChoices[0]?.profile.id
        ?? "";

  const selectedChoice: ProfileChoice | undefined = profileChoices.find(
    (choice) => choice.profile.id === profileId,
  );
  const selectedMatch = view?.matches.find(
    (match) => match.profileId === profileId,
  );
  const rankedMatch = view?.refresh?.resolution.ranked.find(
    (candidate) => candidate.repository === repository,
  );
  const confidence = selectedMatch?.confidence ?? rankedMatch?.confidence;
  const reasons = selectedMatch?.reasons.length
    ? selectedMatch.reasons
    : rankedMatch?.reasons ?? [];

  async function mutate(
    action: "refresh" | "confirm" | "reject",
  ): Promise<void> {
    setBusy(action);
    setError(undefined);
    setNotice(undefined);
    try {
      const body = action === "refresh"
        ? { action, repository }
        : action === "confirm"
          ? { action, repository, workspaceRoot, profileId }
          : { action, profileId };
      const response = await fetch(
        `/api/problems/${encodeURIComponent(problemId)}/repository-match`,
        {
          method: "PUT",
          headers: requestHeaders(orgId, true),
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json() as ProblemRepositoryMatchReviewResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Repository review could not be saved.");
      }
      setView(payload);
      if (action === "refresh") {
        setNotice(
          "Detection refreshed. New profiles remain inactive until an administrator confirms them.",
        );
      } else if (action === "reject") {
        setNotice("Repository suggestion rejected. No ticket context was changed.");
      } else if (payload.confirmation?.engineeringSpecificationUpdated) {
        setNotice(
          "Repository match confirmed. The draft ticket now uses the reviewed repository, branch, and commit.",
        );
      } else {
        setNotice(
          payload.confirmation?.engineeringUpdateReason
            ? `Repository match confirmed. ${payload.confirmation.engineeringUpdateReason}`
            : "Repository match confirmed.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Repository review could not be saved.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  if (loading) {
    return (
      <div className="repository-match-loading" role="status">
        Checking repository execution context<span aria-hidden="true">…</span>
      </div>
    );
  }
  if (error && !view) {
    return (
      <div className="callout warning repository-match-load-error" role="alert">
        <div className="callout-title"><AlertCircle size={14} />Repository review unavailable</div>
        <p className="subtle">{error}</p>
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!view?.available) return null;

  const activeSelection = selectedChoice?.state === "active";
  const confirmDisabled =
    !view.canReview ||
    !activeSelection ||
    Boolean(busy) ||
    view.confirmedMatch?.profileId === selectedChoice?.profile.id;

  return (
    <section className="repository-match-review" aria-labelledby="repository-match-title">
      <div className="repository-match-head">
        <div>
          <h3 id="repository-match-title">Repository execution context</h3>
          <p className="subtle">
            Review the authorized repository, monorepo root, and immutable profile
            before Prompt Testing reads code or generates an acceptance test.
          </p>
        </div>
        <span className={`badge ${view.pddProfileReady ? "success" : "medium"}`}>
          {view.pddProfileReady ? (
            <><CheckCircle2 size={13} />Repository ready</>
          ) : (
            <><ShieldCheck size={13} />Repository review required</>
          )}
        </span>
      </div>

      {view.repositories.length === 0 ? (
        <div className="repository-match-empty">
          <GitBranch size={18} />
          <div>
            <strong>No authorized repository</strong>
            <p className="subtle">
              Select a repository in GitHub integration settings before reviewing
              this ticket.
            </p>
          </div>
          <Link className="btn secondary" href="/settings#integrations">Open settings</Link>
        </div>
      ) : (
        <>
          <div className="repository-match-fields">
            <label className="field">
              Repository
              <select
                value={repository}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setRepository(event.target.value);
                  setNotice(undefined);
                  setError(undefined);
                }}
              >
                {view.repositories.map((item) => (
                  <option key={item.id} value={item.repository}>
                    {item.repository} · {item.defaultBranch}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Workspace root
              <select
                value={workspaceRoot}
                disabled={!roots.length || Boolean(busy)}
                onChange={(event) => {
                  setWorkspaceRoot(event.target.value);
                  setNotice(undefined);
                  setError(undefined);
                }}
              >
                {roots.length === 0 && <option value="">Detection required</option>}
                {roots.map((root) => <option key={root} value={root}>{root}</option>)}
              </select>
            </label>
            <label className="field">
              Execution profile
              <select
                value={profileId}
                disabled={!profileChoices.length || Boolean(busy)}
                onChange={(event) => {
                  setProfileId(event.target.value);
                  setNotice(undefined);
                  setError(undefined);
                }}
              >
                {profileChoices.length === 0 && <option value="">Detection required</option>}
                {profileChoices.map((choice) => (
                  <option key={`${choice.state}:${choice.profile.id}`} value={choice.profile.id}>
                    Version {choice.profile.version} · {choice.state === "active" ? "Active" : "Detected, inactive"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedChoice ? (
            <div className={`repository-profile-selection ${activeSelection ? "active" : "detected"}`}>
              <div className="repository-profile-selection-head">
                <div>
                  <strong>
                    {selectedChoice.profile.config.language}
                    {selectedChoice.profile.config.framework
                      ? ` · ${selectedChoice.profile.config.framework}`
                      : ""}
                  </strong>
                  <p className="subtle">
                    Root <code>{selectedChoice.profile.workspaceRoot}</code> · hash{" "}
                    <code title={selectedChoice.profile.contentHash}>
                      {compactHash(selectedChoice.profile.contentHash)}
                    </code>
                  </p>
                </div>
                <span className={`badge ${activeSelection ? "success" : "medium"}`}>
                  {activeSelection ? "Active profile" : "Detected only"}
                </span>
              </div>
              {!activeSelection && (
                <p className="repository-profile-boundary">
                  <AlertCircle size={14} />This detection is review-only and cannot
                  run Prompt Testing. An administrator must confirm it in{" "}
                  <Link href="/settings#execution">execution profile settings</Link>.
                </p>
              )}
              {confidence !== undefined && (
                <div className="repository-match-evidence">
                  <strong>{percent.format(confidence)} match confidence</strong>
                  {reasons.length > 0 && (
                    <ul>
                      {reasons.slice(0, 5).map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="repository-match-empty compact">
              <AlertCircle size={18} />
              <div>
                <strong>No execution profile detected</strong>
                <p className="subtle">
                  Refresh bounded repository metadata, then review and activate a
                  profile before confirming this ticket.
                </p>
              </div>
            </div>
          )}

          <div className="repository-match-actions">
            {view.canRefreshDetection && (
              <button
                type="button"
                className="btn secondary"
                disabled={!repository || Boolean(busy)}
                onClick={() => void mutate("refresh")}
              >
                <RefreshCw size={14} className={busy === "refresh" ? "spin" : undefined} />
                {busy === "refresh" ? "Refreshing…" : "Refresh detection"}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={confirmDisabled}
              onClick={() => void mutate("confirm")}
            >
              <ShieldCheck size={14} />
              {busy === "confirm"
                ? "Confirming…"
                : view.confirmedMatch?.profileId === selectedChoice?.profile.id
                  ? "Confirmed"
                  : "Confirm for this ticket"}
            </button>
            {selectedMatch?.status === "Suggested" && view.canReview && (
              <button
                type="button"
                className="btn danger"
                disabled={Boolean(busy)}
                onClick={() => void mutate("reject")}
              >
                <XCircle size={14} />
                {busy === "reject" ? "Rejecting…" : "Reject suggestion"}
              </button>
            )}
          </div>
        </>
      )}

      {view.matches.length > 0 && (
        <details className="repository-match-history">
          <summary>Review history · {view.matches.length}</summary>
          <ul>
            {view.matches.map((match) => (
              <li key={`${match.repository}:${match.workspaceRoot}`}>
                <div>
                  <strong>{match.repository}</strong>
                  <span className="subtle">
                    {match.workspaceRoot} · {percent.format(match.confidence)} confidence
                  </span>
                </div>
                <span className={`badge ${match.status === "Confirmed" ? "success" : match.status === "Rejected" ? "high" : "medium"}`}>
                  {match.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {notice && <p className="toast success" role="status">{notice}</p>}
      {error && <p className="toast error" role="alert">{error}</p>}
    </section>
  );
}
