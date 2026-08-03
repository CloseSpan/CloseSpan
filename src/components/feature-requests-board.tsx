"use client";

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  ListTodo,
  LoaderCircle,
  Plus,
  Rocket,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { FitText } from "@/components/fit-text";
import type {
  FeatureRequestSubmission,
  FeatureRequestStatus,
  PublicFeatureRequest,
} from "@/lib/feature-request-repository";
import { TURNSTILE_ACTIONS } from "@/lib/turnstile-config";

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

const TYPING_SOUND_PREFERENCE_KEY = "closespan-feature-request-typing-sound";
const RECENT_SUBMISSIONS_KEY = "closespan-feature-request-submissions";

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
  turnstileSiteKey,
}: {
  initialRequests: PublicFeatureRequest[];
  initialPendingRequests?: FeatureRequestSubmission[];
  canModerate?: boolean;
  initialError?: string;
  turnstileSiteKey: string;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [pendingRequests, setPendingRequests] = useState(
    initialPendingRequests,
  );
  const [recentSubmissions, setRecentSubmissions] = useState<
    FeatureRequestSubmission[]
  >([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogClosing, setDialogClosing] = useState(false);
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set());
  const [pendingModerations, setPendingModerations] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [typingSoundEnabled, setTypingSoundEnabled] = useState(true);
  const [voteTurnstileToken, setVoteTurnstileToken] = useState<string | null>(
    null,
  );
  const [voteTurnstileResetKey, setVoteTurnstileResetKey] = useState(0);
  const [requestTurnstileToken, setRequestTurnstileToken] = useState<
    string | null
  >(null);
  const [requestTurnstileResetKey, setRequestTurnstileResetKey] = useState(0);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(initialError ? { kind: "error", message: initialError } : null);
  const titleInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const voteTurnstileTokenRef = useRef<string | null>(null);
  const typingAudioContext = useRef<AudioContext | null>(null);
  const lastTypingSoundAt = useRef(0);

  useEffect(() => {
    let active = true;
    try {
      const stored = window.sessionStorage.getItem(RECENT_SUBMISSIONS_KEY);
      if (!stored) return () => void (active = false);
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return () => void (active = false);
      const validSubmissions = parsed.filter(
        (item): item is FeatureRequestSubmission =>
          Boolean(item) &&
          typeof item === "object" &&
          "id" in item &&
          typeof item.id === "string" &&
          "title" in item &&
          typeof item.title === "string" &&
          "description" in item &&
          typeof item.description === "string" &&
          "moderationStatus" in item &&
          item.moderationStatus === "Pending review" &&
          "createdAt" in item &&
          typeof item.createdAt === "string",
      );
      queueMicrotask(() => {
        if (active) setRecentSubmissions(validSubmissions);
      });
    } catch {
      window.sessionStorage.removeItem(RECENT_SUBMISSIONS_KEY);
    }
    return () => void (active = false);
  }, []);

  useEffect(() => {
    let preferenceFrame = 0;
    try {
      const storedPreference = window.sessionStorage.getItem(
        TYPING_SOUND_PREFERENCE_KEY,
      );
      if (storedPreference === "off") {
        preferenceFrame = window.requestAnimationFrame(() => {
          setTypingSoundEnabled(false);
        });
      }
    } catch {
      // Session storage may be unavailable in privacy-restricted browsers.
    }

    return () => {
      if (preferenceFrame) window.cancelAnimationFrame(preferenceFrame);
      const context = typingAudioContext.current;
      typingAudioContext.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  function toggleTypingSound() {
    setTypingSoundEnabled((current) => {
      const next = !current;
      try {
        window.sessionStorage.setItem(
          TYPING_SOUND_PREFERENCE_KEY,
          next ? "on" : "off",
        );
      } catch {
        // The toggle still works for this visit without storage.
      }
      return next;
    });
  }

  function getInterfaceAudioContext() {
    const context =
      typingAudioContext.current ??
      (typingAudioContext.current = new window.AudioContext());
    if (context.state === "suspended") void context.resume();
    return context;
  }

  function playButtonClickSound(force = false) {
    if (!typingSoundEnabled && !force) return;

    try {
      const context = getInterfaceAudioContext();
      const now = context.currentTime;
      const duration = 0.045;
      const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
      const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < sampleCount; index += 1) {
        const decay = Math.pow(1 - index / sampleCount, 5);
        samples[index] = (Math.random() * 2 - 1) * decay;
      }

      const switchStrike = context.createBufferSource();
      const strikeFilter = context.createBiquadFilter();
      const strikeGain = context.createGain();
      strikeFilter.type = "bandpass";
      strikeFilter.frequency.value = 980;
      strikeFilter.Q.value = 1.15;
      strikeGain.gain.setValueAtTime(0.038, now);
      strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      switchStrike.buffer = buffer;
      switchStrike.connect(strikeFilter);
      strikeFilter.connect(strikeGain);
      strikeGain.connect(context.destination);

      const buttonBody = context.createOscillator();
      const bodyGain = context.createGain();
      buttonBody.type = "triangle";
      buttonBody.frequency.setValueAtTime(122, now);
      bodyGain.gain.setValueAtTime(0.016, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      buttonBody.connect(bodyGain);
      bodyGain.connect(context.destination);

      switchStrike.start(now);
      switchStrike.stop(now + duration);
      buttonBody.start(now);
      buttonBody.stop(now + 0.065);
    } catch {
      // Sound feedback must never prevent the underlying button action.
    }
  }

  function playTypingSound(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (
      !typingSoundEnabled ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;

    const isCharacter = event.key.length === 1;
    const isEditingKey = ["Backspace", "Delete", "Enter"].includes(event.key);
    if (!isCharacter && !isEditingKey) return;

    const timestamp = performance.now();
    if (timestamp - lastTypingSoundAt.current < 24) return;
    lastTypingSoundAt.current = timestamp;

    try {
      const context = getInterfaceAudioContext();

      const isSpace = event.key === " ";
      const isErase = event.key === "Backspace" || event.key === "Delete";
      const isEnter = event.key === "Enter";
      const isLongKey = isSpace || isErase || isEnter;
      const keySignature = Array.from(event.key).reduce(
        (total, character) => total + character.charCodeAt(0),
        0,
      );
      const pitchVariation = (keySignature % 9) - 4;
      const duration = isEnter ? 0.07 : isLongKey ? 0.055 : 0.042;
      const now = context.currentTime;
      const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
      const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
      const samples = buffer.getChannelData(0);
      const releaseIndex = Math.floor(context.sampleRate * 0.012);
      for (let index = 0; index < sampleCount; index += 1) {
        const strikeDecay = Math.pow(1 - index / sampleCount, 4.5);
        const releasePosition = Math.max(0, index - releaseIndex);
        const releaseLength = Math.max(1, sampleCount - releaseIndex);
        const releaseDecay =
          index >= releaseIndex
            ? Math.pow(1 - releasePosition / releaseLength, 7) * 0.34
            : 0;
        samples[index] =
          (Math.random() * 2 - 1) * (strikeDecay + releaseDecay);
      }

      const strike = context.createBufferSource();
      const strikeFilter = context.createBiquadFilter();
      const strikeGain = context.createGain();
      strikeFilter.type = "bandpass";
      strikeFilter.Q.value = 0.9;
      strikeFilter.frequency.value = isEnter
        ? 820
        : isSpace
          ? 1050
          : isErase
            ? 1250
            : 1650 + pitchVariation * 55;
      strikeGain.gain.setValueAtTime(isLongKey ? 0.04 : 0.032, now);
      strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      strike.buffer = buffer;
      strike.connect(strikeFilter);
      strikeFilter.connect(strikeGain);
      strikeGain.connect(context.destination);

      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = "triangle";
      body.frequency.setValueAtTime(
        isEnter
          ? 92
          : isSpace
            ? 112
            : isErase
              ? 128
              : 168 + pitchVariation * 4,
        now,
      );
      bodyGain.gain.setValueAtTime(isLongKey ? 0.017 : 0.012, now);
      bodyGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + duration + 0.018,
      );
      body.connect(bodyGain);
      bodyGain.connect(context.destination);

      strike.start(now);
      body.start(now);
      strike.stop(now + duration);
      body.stop(now + duration + 0.02);

      if (isEnter) {
        const returnBell = context.createOscillator();
        const returnBellGain = context.createGain();
        returnBell.type = "sine";
        returnBell.frequency.setValueAtTime(880, now + 0.015);
        returnBellGain.gain.setValueAtTime(0.007, now + 0.015);
        returnBellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        returnBell.connect(returnBellGain);
        returnBellGain.connect(context.destination);
        returnBell.start(now + 0.015);
        returnBell.stop(now + 0.125);
      }
    } catch {
      // Audio is an enhancement; unsupported audio must never block typing.
    }
  }

  function updateVoteTurnstileToken(token: string | null) {
    voteTurnstileTokenRef.current = token;
    setVoteTurnstileToken(token);
  }

  function openRequestDialog() {
    playButtonClickSound();
    dialogTrigger.current = document.activeElement as HTMLElement | null;
    setRequestTurnstileToken(null);
    setDialogClosing(false);
    setDialogOpen(true);
  }

  function closeRequestDialog() {
    if (!dialogOpen || dialogClosing) return;
    setDialogClosing(true);
  }

  useEffect(() => {
    if (!dialogClosing) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const closeDelay = reducedMotion ? 0 : 420;
    const closeTimer = window.setTimeout(() => {
      setDialogOpen(false);
      setDialogClosing(false);
    }, closeDelay);

    return () => window.clearTimeout(closeTimer);
  }, [dialogClosing]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogClosing(true);
      if (event.key !== "Tab" || !dialog.current) return;

      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      dialogTrigger.current?.focus();
    };
  }, [dialogOpen]);

  async function vote(
    requestId: string,
    direction: "up" | "down",
  ) {
    if (pendingVotes.has(requestId)) return;
    const turnstileToken = voteTurnstileTokenRef.current;
    if (!turnstileToken) {
      setNotice({
        kind: "error",
        message: "Wait for the security check to finish, then try again.",
      });
      return;
    }
    updateVoteTurnstileToken(null);
    setPendingVotes((current) => new Set(current).add(requestId));
    setNotice(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken, direction }),
      });
      const body = (await response.json()) as {
        requestId?: string;
        upvoteCount?: number;
        downvoteCount?: number;
        viewerVote?: "up" | "down";
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
                upvoteCount:
                  typeof body.upvoteCount === "number"
                    ? body.upvoteCount
                    : item.upvoteCount,
                downvoteCount:
                  typeof body.downvoteCount === "number"
                    ? body.downvoteCount
                    : item.downvoteCount,
                viewerVote: body.viewerVote ?? item.viewerVote,
              }
            : item,
        ),
      );
      setNotice({
        kind: "success",
        message:
          body.status === "already_voted"
            ? `Your ${direction}vote was already counted.`
            : body.status === "updated"
              ? `Your vote was changed to a ${direction}vote.`
              : `Your ${direction}vote was counted.`,
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
      setVoteTurnstileResetKey((current) => current + 1);
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
    const turnstileToken = requestTurnstileToken;
    if (!turnstileToken) {
      setSubmitting(false);
      setNotice({
        kind: "error",
        message: "Wait for the security check to finish, then try again.",
      });
      return;
    }
    setRequestTurnstileToken(null);
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
          turnstileToken,
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
      } else {
        setRecentSubmissions((current) => {
          const next = [
            body.submission!,
            ...current.filter((item) => item.id !== body.submission!.id),
          ];
          window.sessionStorage.setItem(
            RECENT_SUBMISSIONS_KEY,
            JSON.stringify(next),
          );
          return next;
        });
      }
      form.reset();
      closeRequestDialog();
      setNotice({
        kind: "success",
        message:
          "Your request is saved and awaiting review. You can see it below until it is published.",
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
      setRequestTurnstileResetKey((current) => current + 1);
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
        submission?: FeatureRequestSubmission | null;
        error?: string;
      };
      if (!response.ok)
        throw new Error(responseError(body, "The review could not be saved"));
      setPendingRequests((current) =>
        decision === "publish"
          ? current.filter((request) => request.id !== requestId)
          : current.map((request) =>
              request.id === requestId
                ? (body.submission ?? {
                    ...request,
                    moderationStatus: "Rejected",
                  })
                : request,
            ),
      );
      if (decision === "publish" && body.request) {
        setRequests((current) => [...current, body.request!]);
      }
      setNotice({
        kind: "success",
        message:
          decision === "publish"
            ? "The request is now public and open for voting."
            : "The request was marked as rejected and remains visible to moderators.",
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
            second.upvoteCount -
              second.downvoteCount -
              (first.upvoteCount - first.downvoteCount) ||
            second.upvoteCount - first.upvoteCount ||
            second.createdAt.localeCompare(first.createdAt),
        ),
    }))
    .filter((group) => group.requests.length > 0);
  const hasAnyRequests =
    requests.length > 0 ||
    recentSubmissions.length > 0 ||
    (canModerate && pendingRequests.length > 0);

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
              onClick={() => {
                playButtonClickSound();
                setNotice(null);
              }}
              aria-label="Dismiss message"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        )}

        {requests.some((request) => request.votingOpen) && (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            action={TURNSTILE_ACTIONS.featureRequestVote}
            resetKey={voteTurnstileResetKey}
            onTokenChange={updateVoteTurnstileToken}
          />
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
                  Request review
                </h2>
              </div>
              <span>
                {
                  pendingRequests.filter(
                    (request) => request.moderationStatus === "Pending review",
                  ).length
                }
              </span>
            </header>
            <div>
              {pendingRequests.map((request) => {
                const reviewing = pendingModerations.has(request.id);
                const rejected = request.moderationStatus === "Rejected";
                return (
                  <article
                    className={rejected ? "rejected" : undefined}
                    key={request.id}
                  >
                    <div>
                      <FitText as="h3" minFontSize={12} maxLines={2}>
                        {request.title}
                      </FitText>
                      <p>{request.description}</p>
                    </div>
                    {rejected ? (
                      <span className="feature-request-rejected-label">
                        Rejected
                      </span>
                    ) : (
                      <div>
                        <button
                          type="button"
                          disabled={reviewing}
                          onClick={() => {
                            playButtonClickSound();
                            void moderateRequest(request.id, "reject");
                          }}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="publish"
                          disabled={reviewing}
                          onClick={() => {
                            playButtonClickSound();
                            void moderateRequest(request.id, "publish");
                          }}
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
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!canModerate && recentSubmissions.length > 0 && (
          <section
            className="feature-request-submission-queue"
            aria-labelledby="feature-request-submission-heading"
          >
            <header>
              <div>
                <span>Your submissions</span>
                <h2 id="feature-request-submission-heading">
                  Awaiting review
                </h2>
              </div>
              <span>{recentSubmissions.length}</span>
            </header>
            <div>
              {recentSubmissions.map((request) => (
                <article key={request.id}>
                  <div>
                    <FitText as="h3" minFontSize={12} maxLines={2}>
                      {request.title}
                    </FitText>
                    <p>{request.description}</p>
                  </div>
                  <span>Pending</span>
                </article>
              ))}
            </div>
          </section>
        )}

        {!hasAnyRequests ? (
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
              onClick={openRequestDialog}
            >
              <Plus aria-hidden="true" size={16} /> New request
            </button>
          </section>
        ) : visibleGroups.length > 0 ? (
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
                          <FitText as="h3" minFontSize={13} maxLines={2}>
                            {request.title}
                          </FitText>
                          <p>{request.description}</p>
                        </div>
                        <div className="feature-request-votes">
                          <button
                            type="button"
                            className={
                              request.viewerVote === "up" ? "voted" : ""
                            }
                            aria-label={`Upvote ${request.title}. ${request.upvoteCount} ${
                              request.upvoteCount === 1
                                ? "upvote"
                                : "upvotes"
                            }`}
                            aria-pressed={request.viewerVote === "up"}
                            disabled={
                              voting ||
                              !voteTurnstileToken ||
                              !request.votingOpen
                            }
                            onClick={() => {
                              playButtonClickSound();
                              void vote(request.id, "up");
                            }}
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
                            <span>{request.upvoteCount}</span>
                          </button>
                          <button
                            type="button"
                            className={
                              request.viewerVote === "down" ? "voted down" : ""
                            }
                            aria-label={`Downvote ${request.title}. ${request.downvoteCount} ${
                              request.downvoteCount === 1
                                ? "downvote"
                                : "downvotes"
                            }`}
                            aria-pressed={request.viewerVote === "down"}
                            disabled={
                              voting ||
                              !voteTurnstileToken ||
                              !request.votingOpen
                            }
                            onClick={() => {
                              playButtonClickSound();
                              void vote(request.id, "down");
                            }}
                          >
                            <ArrowDown aria-hidden="true" size={14} />
                            <span>{request.downvoteCount}</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {visibleGroups.length > 0 && (
          <p className="feature-request-vote-note">
            One upvote or downvote per request, per network address. You can
            change your choice. CloseSpan stores only a one-way security
            fingerprint; your raw IP address is not stored.
          </p>
        )}
      </main>

      {hasAnyRequests && (
        <button
          className="feature-request-new"
          type="button"
          onClick={openRequestDialog}
        >
          <Plus aria-hidden="true" size={17} /> New request
        </button>
      )}

      {dialogOpen && (
        <div
          className={`feature-request-dialog-backdrop${
            dialogClosing ? " is-closing" : ""
          }`}
          onAnimationEnd={(event) => {
            if (
              event.currentTarget === event.target &&
              dialogClosing &&
              event.animationName === "feature-request-backdrop-exit"
            ) {
              setDialogOpen(false);
              setDialogClosing(false);
            }
          }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeRequestDialog();
          }}
        >
          <section
            ref={dialog}
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
              <div className="feature-request-dialog-controls">
                <button
                  type="button"
                  className="feature-request-sound-toggle"
                  onClick={() => {
                    playButtonClickSound(true);
                    toggleTypingSound();
                  }}
                  aria-label={
                    typingSoundEnabled
                      ? "Mute form sounds"
                      : "Turn on form sounds"
                  }
                  aria-pressed={typingSoundEnabled}
                  title={
                    typingSoundEnabled ? "Form sounds on" : "Form sounds off"
                  }
                >
                  {typingSoundEnabled ? (
                    <Volume2 aria-hidden="true" size={18} />
                  ) : (
                    <VolumeX aria-hidden="true" size={18} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playButtonClickSound();
                    closeRequestDialog();
                  }}
                  aria-label="Close request form"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
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
                  onKeyDown={playTypingSound}
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
                  onKeyDown={playTypingSound}
                />
              </label>
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                action={TURNSTILE_ACTIONS.featureRequestSubmit}
                resetKey={requestTurnstileResetKey}
                onTokenChange={setRequestTurnstileToken}
              />
              <p>
                CloseSpan reviews submissions before they appear publicly.
                Avoid customer data, credentials, or other sensitive
                information.
              </p>
              <div className="feature-request-actions">
                <button
                  type="button"
                  className="feature-request-secondary"
                  onClick={() => {
                    playButtonClickSound();
                    closeRequestDialog();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="feature-request-primary"
                  disabled={submitting || !requestTurnstileToken}
                  onClick={() => playButtonClickSound()}
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
