"use client";

import {
  ArrowUp,
  CheckCircle2,
  Clock3,
  ListTodo,
  LoaderCircle,
  Plus,
  Rocket,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  FeatureRequestSubmission,
  FeatureRequestStatus,
  PublicFeatureRequest,
} from "@/lib/feature-request-repository";

const groups: Array<{
  status: FeatureRequestStatus;
  label: string;
  description: string;
  icon: typeof Clock3;
}> = [
  {
    status: "Planned",
    label: "Planned",
    description: "Accepted improvements on the product roadmap.",
    icon: Clock3,
  },
  {
    status: "In progress",
    label: "In progress",
    description: "Improvements the team is actively building.",
    icon: LoaderCircle,
  },
  {
    status: "Backlog",
    label: "Backlog",
    description: "Community requests under consideration.",
    icon: ListTodo,
  },
  {
    status: "Shipped",
    label: "Shipped",
    description: "Requested improvements now available in CloseSpan.",
    icon: Rocket,
  },
];

function responseError(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  )
    return body.error;
  return fallback;
}

export function FeatureRequestsBoard({
  initialRequests,
  initialPendingRequests = [],
  canModerate = false,
  initialError,
}: {
  initialRequests: PublicFeatureRequest[];
  initialPendingRequests?: FeatureRequestSubmission[];
  canModerate?: boolean;
  initialError?: string;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [pendingRequests, setPendingRequests] = useState(
    initialPendingRequests,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set());
  const [pendingModerations, setPendingModerations] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(initialError ? { kind: "error", message: initialError } : null);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    titleInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialogOpen]);

  async function vote(requestId: string) {
    if (pendingVotes.has(requestId)) return;
    setPendingVotes((current) => new Set(current).add(requestId));
    setNotice(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as {
        requestId?: string;
        voteCount?: number;
        viewerHasVoted?: boolean;
        status?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(responseError(body, "Your vote could not be recorded"));
      setRequests((current) =>
        current.map((item) =>
          item.id === requestId
            ? {
                ...item,
                voteCount:
                  typeof body.voteCount === "number"
                    ? body.voteCount
                    : item.voteCount,
                viewerHasVoted: body.viewerHasVoted === true,
              }
            : item,
        ),
      );
      setNotice({
        kind: "success",
        message:
          body.status === "already_voted"
            ? "Your vote was already counted."
            : "Your vote was counted.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your vote could not be recorded",
      });
    } finally {
      setPendingVotes((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
        }),
      });
      const body = (await response.json()) as {
        submission?: FeatureRequestSubmission;
        error?: string;
      };
      if (!response.ok || !body.submission)
        throw new Error(
          responseError(body, "Your request could not be submitted"),
        );
      if (canModerate) {
        setPendingRequests((current) => [...current, body.submission!]);
      }
      form.reset();
      setDialogOpen(false);
      setNotice({
        kind: "success",
        message: "Your request was submitted for review.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Your request could not be submitted",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function moderateRequest(
    requestId: string,
    decision: "publish" | "reject",
  ) {
    if (pendingModerations.has(requestId)) return;
    setPendingModerations((current) => new Set(current).add(requestId));
    setNotice(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/moderation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ decision }),
      });
      const body = (await response.json()) as {
        request?: PublicFeatureRequest | null;
        error?: string;
      };
      if (!response.ok)
        throw new Error(responseError(body, "The review could not be saved"));
      setPendingRequests((current) =>
        current.filter((request) => request.id !== requestId),
      );
      if (decision === "publish" && body.request) {
        setRequests((current) => [...current, body.request!]);
      }
      setNotice({
        kind: "success",
        message:
          decision === "publish"
            ? "The request is now public and open for voting."
            : "The request was rejected and remains private.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The review could not be saved",
      });
    } finally {
      setPendingModerations((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      requests: requests
        .filter((request) => request.status === group.status)
        .sort(
          (first, second) =>
            second.voteCount - first.voteCount ||
            second.createdAt.localeCompare(first.createdAt),
        ),
    }))
    .filter((group) => group.requests.length > 0);

  return (
    <>
      <main className="feature-requests-main" id="requests-content">
        <div className="feature-requests-intro">
          <span>Shape what comes next</span>
          <h1>Feature requests</h1>
          <p>
            Explore the CloseSpan roadmap, suggest an improvement, and support
            the requests that would help your team most.
          </p>
        </div>

        {notice && (
          <div
            className={`feature-request-notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.kind === "success" && (
              <CheckCircle2 aria-hidden="true" size={17} />
            )}
            <span>{notice.message}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss message"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        )}

        {canModerate && pendingRequests.length > 0 && (
          <section
            className="feature-request-review-queue"
            aria-labelledby="feature-request-review-heading"
          >
            <header>
              <div>
                <span>Moderator view</span>
                <h2 id="feature-request-review-heading">
                  Waiting for review
                </h2>
              </div>
              <span>{pendingRequests.length}</span>
            </header>
            <div>
              {pendingRequests.map((request) => {
                const reviewing = pendingModerations.has(request.id);
                return (
                  <article key={request.id}>
                    <div>
                      <h3>{request.title}</h3>
                      <p>{request.description}</p>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() =>
                          void moderateRequest(request.id, "reject")
                        }
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="publish"
                        disabled={reviewing}
                        onClick={() =>
                          void moderateRequest(request.id, "publish")
                        }
                      >
                        {reviewing ? (
                          <LoaderCircle
                            className="feature-request-spinner"
                            aria-hidden="true"
                            size={14}
                          />
                        ) : (
                          <CheckCircle2 aria-hidden="true" size={14} />
                        )}
                        Publish
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {visibleGroups.length === 0 ? (
          <section className="feature-request-empty">
            <span aria-hidden="true">
              <ListTodo size={24} />
            </span>
            <h2>Start the roadmap conversation</h2>
            <p>
              There are no public requests yet. Share the first improvement
              you would like CloseSpan to consider.
            </p>
            <button
              className="feature-request-primary"
              type="button"
              onClick={() => setDialogOpen(true)}
            >
              <Plus aria-hidden="true" size={16} /> New request
            </button>
          </section>
        ) : (
          <div className="feature-request-groups">
            {visibleGroups.map(({ icon: Icon, ...group }) => (
              <section
                className="feature-request-group"
                aria-labelledby={`feature-request-${group.status}`}
                key={group.status}
              >
                <header>
                  <span className={`feature-request-status-icon ${group.status.toLowerCase().replace(" ", "-")}`}>
                    <Icon aria-hidden="true" size={15} />
                  </span>
                  <div>
                    <h2 id={`feature-request-${group.status}`}>
                      {group.label}
                    </h2>
                    <p>{group.description}</p>
                  </div>
                  <span className="feature-request-count">
                    {group.requests.length}
                  </span>
                </header>
                <div className="feature-request-list">
                  {group.requests.map((request) => {
                    const voting = pendingVotes.has(request.id);
                    return (
                      <article className="feature-request-row" key={request.id}>
                        <div>
                          <h3>{request.title}</h3>
                          <p>{request.description}</p>
                        </div>
                        <button
                          type="button"
                          className={request.viewerHasVoted ? "voted" : ""}
                          aria-label={`${
                            request.viewerHasVoted ? "Voted for" : "Vote for"
                          } ${request.title}. ${request.voteCount} ${
                            request.voteCount === 1 ? "vote" : "votes"
                          }`}
                          aria-pressed={request.viewerHasVoted}
                          disabled={
                            voting ||
                            request.viewerHasVoted ||
                            !request.votingOpen
                          }
                          onClick={() => void vote(request.id)}
                        >
                          {voting ? (
                            <LoaderCircle
                              className="feature-request-spinner"
                              aria-hidden="true"
                              size={14}
                            />
                          ) : (
                            <ArrowUp aria-hidden="true" size={14} />
                          )}
                          <span>{request.voteCount}</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <p className="feature-request-vote-note">
          One vote per request, per network address. CloseSpan stores only a
          one-way security fingerprint. Your raw IP address is not stored.
        </p>
      </main>

      <button
        className="feature-request-new"
        type="button"
        onClick={() => setDialogOpen(true)}
      >
        <Plus aria-hidden="true" size={17} /> New request
      </button>

      {dialogOpen && (
        <div
          className="feature-request-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDialogOpen(false);
          }}
        >
          <section
            className="feature-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-feature-request-title"
          >
            <header>
              <div>
                <span>Suggest an improvement</span>
                <h2 id="new-feature-request-title">New feature request</h2>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                aria-label="Close request form"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <form onSubmit={submitRequest}>
              <label>
                Request title
                <input
                  ref={titleInput}
                  name="title"
                  minLength={4}
                  maxLength={120}
                  required
                  placeholder="What should CloseSpan add or improve?"
                />
              </label>
              <label>
                Why would this help?
                <textarea
                  name="description"
                  minLength={10}
                  maxLength={2000}
                  required
                  placeholder="Describe the workflow, pain point, and outcome you need."
                />
              </label>
              <p>
                CloseSpan reviews submissions before they appear publicly.
                Avoid customer data, credentials, or other sensitive
                information.
              </p>
              <div>
                <button
                  type="button"
                  className="feature-request-secondary"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="feature-request-primary"
                  disabled={submitting}
                >
                  {submitting ? (
                    <LoaderCircle
                      className="feature-request-spinner"
                      aria-hidden="true"
                      size={16}
                    />
                  ) : (
                    <Plus aria-hidden="true" size={16} />
                  )}
                  {submitting ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
