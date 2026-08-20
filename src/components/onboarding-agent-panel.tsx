"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  Building2,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  Mail,
  PlugZap,
  Sparkles,
} from "lucide-react";
import { PipedreamConnectButton } from "@/components/pipedream-connect-button";
import { IntegrationSyncStatus } from "@/components/integration-sync-status";
import { IntegrationProviderIcon } from "@/components/integration-provider-icon";
import { PublicSourceDiscovery } from "@/components/public-source-discovery";
import { RepositoryContextProgress } from "@/components/repository-context-progress";
import { RepositoryActivationProgress } from "@/components/repository-activation-progress";
import {
  isFeedbackSourceIntegration,
  isIntegrationAvailable,
} from "@/lib/integration-catalog";
import type { IntegrationConnectionState } from "@/lib/integration-client";
import type { WorkspaceSetupStatus } from "@/lib/integration-repository";
import { isPipedreamConnectorId } from "@/lib/pipedream-connectors";
import {
  prioritizeOnboardingContinuation,
  resolvedConnectorFailure,
} from "@/lib/onboarding-guidance";
import type { OnboardingAction } from "@/lib/onboarding-agent";
import type { OnboardingState } from "@/lib/onboarding-repository";

const STARTER_CHIPS = [
  "We don't have a website yet",
];

const FRIENDLY_ERROR =
  "Something went wrong. Please try again in a moment.";

const GITHUB_CALLBACK_ERRORS: Readonly<Record<string, string>> = {
  authentication_required:
    "CloseSpan could not match the GitHub return to your signed-in workspace.",
  administrator_required:
    "A workspace administrator must finish linking this GitHub installation.",
  install_request_expired:
    "The GitHub connection request expired before CloseSpan received the installation.",
  installation_unavailable:
    "GitHub is installed, but CloseSpan could not link the selected repository to this workspace.",
  invalid_callback:
    "GitHub returned without the information CloseSpan needs to link this workspace.",
  connection_failed:
    "GitHub kept the installation, but CloseSpan could not finish linking it to this workspace.",
};

const SUPPORT_EMAIL = "support@closespan.com";
const SUPPORT_REQUEST_PATTERN =
  /^(?:contact|email|message|talk to|speak to|connect (?:me )?(?:to|with))\s+(?:the\s+)?support(?:\s+team)?[.!]?$/i;
const REPLY_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type SupportFlowStep =
  | "idle"
  | "email"
  | "subject"
  | "message"
  | "review"
  | "sent";

interface SupportFlowState {
  step: SupportFlowStep;
  replyEmail: string;
  subject: string;
  message: string;
}

const COMPANY_CONFIRMATION_PROGRESS = [
  "Reviewing confirmed company details",
  "Analyzing product and customer context",
  "Identifying likely feedback sources",
  "Preparing connector recommendations",
  "Waiting for product discovery to finish",
] as const;

interface OnboardingActivityMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  title?: string;
  at: string;
}

function OperationsManagerAvatar() {
  return (
    <span className="delphi-message-avatar" aria-hidden="true">
      <Sparkles size={18} />
    </span>
  );
}

function CompanyConfirmationProgress({
  reducedMotion,
}: {
  reducedMotion: boolean | null;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= COMPANY_CONFIRMATION_PROGRESS.length - 1) return;
    const timer = window.setTimeout(
      () => setStep((current) => current + 1),
      2_600,
    );
    return () => window.clearTimeout(timer);
  }, [step]);

  const message = COMPANY_CONFIRMATION_PROGRESS[step];

  return (
    <motion.div
      className="delphi-company-confirmation-progress"
      role="status"
      aria-live="polite"
      initial={reducedMotion ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <Sparkles size={14} aria-hidden="true" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          className="delphi-company-confirmation-progress-text"
          data-text={message}
          key={message}
          initial={reducedMotion ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {message}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function messageTime(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function companyHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function compactSiteDescription(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const firstSentence = normalized.split(/(?<=[.!?])\s/)[0] ?? normalized;
  return firstSentence.length > 180
    ? `${firstSentence.slice(0, 177).trimEnd()}…`
    : firstSentence;
}

function compactActionText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/(?<=[.!?])\s/)[0] ?? normalized;
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}

function isSafeUserMessage(message: string): boolean {
  return (
    message === FRIENDLY_ERROR ||
    message === "Message is required" ||
    message === "Authentication required" ||
    message === "Too many requests"
  );
}

async function onboardingFetch(
  orgId: string,
  method: "GET" | "POST",
  message?: string,
) {
  const response = await fetch("/api/onboarding", {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: message ? JSON.stringify({ message }) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw =
      typeof payload.error === "string" ? payload.error : FRIENDLY_ERROR;
    throw new Error(isSafeUserMessage(raw) ? raw : FRIENDLY_ERROR);
  }
  return payload;
}

async function integrationFetch(
  path: string,
  orgId: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(path, {
    method: "POST",
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
      typeof payload.error === "string"
        ? payload.error
        : "Integration action failed",
    );
  }
  return payload;
}

async function workspaceSetupFetch(
  orgId: string,
): Promise<WorkspaceSetupStatus> {
  const response = await fetch("/api/integrations/setup", {
    method: "GET",
    headers: {
      "x-org-id": orgId,
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("status_unavailable");
  return (await response.json()) as WorkspaceSetupStatus;
}

async function sendSupportRequest(
  orgId: string,
  payload: { replyEmail: string; subject: string; message: string },
) {
  const response = await fetch("/api/onboarding/support", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    sent?: unknown;
  };
  if (!response.ok || result.sent !== true) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Support email is temporarily unavailable.",
    );
  }
}

async function onboardingActionFetch(
  orgId: string,
  action: "continue" | "confirm_company" | "restart_company",
) {
  const response = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ action }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("onboarding_action_unavailable");
  return payload;
}

export function OnboardingAgentPanel({
  orgId,
  initialSetup,
  githubCallbackStatus,
  githubCallbackReason,
}: {
  orgId: string;
  initialSetup: WorkspaceSetupStatus;
  githubCallbackStatus: string | null;
  githubCallbackReason: string | null;
}) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const shouldFollowConversationRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [actions, setActions] = useState<OnboardingAction[]>([]);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>(STARTER_CHIPS);
  const [draft, setDraft] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [setupStatus, setSetupStatus] =
    useState<WorkspaceSetupStatus>(initialSetup);
  const [connectedIds, setConnectedIds] = useState<string[]>(
    initialSetup.connectedIntegrationIds,
  );
  const [activityMessages, setActivityMessages] = useState<
    OnboardingActivityMessage[]
  >([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const [connectionStates, setConnectionStates] = useState<
    Partial<Record<string, IntegrationConnectionState>>
  >({});
  const [syncRefreshKeys, setSyncRefreshKeys] = useState<
    Record<string, number>
  >({});
  const [supportFlow, setSupportFlow] = useState<SupportFlowState>({
    step: "idle",
    replyEmail: "",
    subject: "",
    message: "",
  });
  const [supportDeliveryError, setSupportDeliveryError] = useState<
    string | null
  >(null);
  const [githubRecoveryNotice, setGithubRecoveryNotice] = useState<
    string | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    onboardingFetch(orgId, "GET")
      .then((payload) => {
        if (cancelled) return;
        const next = payload as OnboardingState & {
          suggestedActions?: OnboardingAction[];
          suggestedReplies?: string[];
          organizationName?: string;
          userEmail?: string;
        };
        setState(next);
        setActions(next.suggestedActions ?? []);
        setSuggestedReplies(next.suggestedReplies ?? []);
        setLoginEmail(next.userEmail?.trim() ?? "");
      })
      .catch(() => {
        if (!cancelled) setError(FRIENDLY_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [loadVersion, orgId]);

  useEffect(() => {
    let cancelled = false;
    const refreshSetup = () => {
      void workspaceSetupFetch(orgId)
        .then((next) => {
          if (cancelled) return;
          setSetupStatus(next);
          setConnectedIds(next.connectedIntegrationIds);
        })
        .catch(() => {
          // Onboarding remains usable while a transient status read recovers.
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSetup();
    };
    refreshSetup();
    window.addEventListener("focus", refreshSetup);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshSetup);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [orgId]);

  const hasProductBrief = Boolean(
    state?.productProfile.companyProfileConfirmed &&
      state.productProfile.productName?.trim(),
  );
  const hasCompanyCandidate = Boolean(
    state?.productProfile.companyProfileReadyForConfirmation &&
      state.productProfile.productName?.trim() &&
      !state.productProfile.companyProfileConfirmed,
  );
  const hasSavedCompanyUrl = Boolean(state?.productProfile.productUrl?.trim());
  const githubConnected = setupStatus.githubConnected;
  const githubInstalled = (setupStatus.github?.installationCount ?? 0) > 0;
  const githubRepositoryCount = setupStatus.github?.repositoryCount ?? 0;
  const githubFailureIsResolved = resolvedConnectorFailure({
    provider: "GitHub",
    connected: githubConnected,
    messages: state?.messages ?? [],
  });
  const displayMessages = useMemo(() => {
    if (!state) return [];
    const automaticCandidate =
      hasCompanyCandidate &&
      state.messages.every((message) => message.role === "assistant");
    if (automaticCandidate) {
      const first = state.messages[0];
      return first
        ? [{ ...first, content: "Hey, How's it going!" }]
        : [];
    }
    let replacedGreeting = false;
    const normalizedMessages = state.messages.map((message) => {
      if (message.role !== "assistant" || replacedGreeting) return message;
      replacedGreeting = true;
      return { ...message, content: "Hey, How's it going!" };
    });
    return normalizedMessages
      .filter((message, index) => {
        if (
          !hasProductBrief ||
          !githubConnected ||
          index === 0 ||
          message.role !== "assistant"
        ) {
          return true;
        }
        const followsConfirmation =
          normalizedMessages[index - 1]?.role === "user" &&
          normalizedMessages[index - 1]?.content.startsWith("Confirmed ");
        if (followsConfirmation) return true;
        return !/(feedback source|intercom|posthog|custom webhook)/i.test(
          message.content,
        );
      })
      .map((message, index) =>
        hasProductBrief &&
        !githubConnected &&
        index > 0 &&
        message.role === "assistant"
          ? {
              ...message,
              content:
                "Connect GitHub to test repositories and open approved PRs, or continue to the workspace and finish setup later.",
            }
          : message,
      );
  }, [githubConnected, hasCompanyCandidate, hasProductBrief, state]);
  const feedbackConnectors = useMemo(
    () =>
      state?.recommendedConnectors.filter(
        (connector) => connector.integrationId !== "int_github",
      ) ?? [],
    [state?.recommendedConnectors],
  );
  const showSourceStage = hasProductBrief && githubConnected;
  const minimumConnectionsReady =
    showSourceStage && setupStatus.feedbackConnected;
  const showComposer = Boolean(
    state &&
      (!hasProductBrief
        ? !hasCompanyCandidate
        : showSourceStage),
  );

  useEffect(() => {
    const stage = stageRef.current;
    const conversation = conversationRef.current;
    if (!stage || !conversation) return;

    let frame = 0;
    const updateFollowPreference = () => {
      const stageBounds = stage.getBoundingClientRect();
      const conversationBottom = conversation.getBoundingClientRect().bottom;
      shouldFollowConversationRef.current =
        conversationBottom >= stageBounds.top - 72 &&
        conversationBottom <= stageBounds.bottom + 72;
    };
    const followConversation = () => {
      if (!shouldFollowConversationRef.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        conversation.scrollIntoView({
          block: "end",
          inline: "nearest",
          behavior: prefersReducedMotion ? "auto" : "smooth",
        });
      });
    };
    const observer = new MutationObserver(followConversation);
    observer.observe(conversation, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resizeObserver = new ResizeObserver(followConversation);
    resizeObserver.observe(conversation);
    stage.addEventListener("scroll", updateFollowPreference, { passive: true });

    shouldFollowConversationRef.current = true;
    followConversation();

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      stage.removeEventListener("scroll", updateFollowPreference);
      window.cancelAnimationFrame(frame);
    };
  }, [minimumConnectionsReady, prefersReducedMotion, showSourceStage]);
  const confirmedSiteDescription = compactSiteDescription(
    state?.productProfile.productDescription ?? null,
  );
  const orderedSuggestedReplies = useMemo(
    () =>
      prioritizeOnboardingContinuation(
        githubFailureIsResolved ? [] : suggestedReplies,
        minimumConnectionsReady,
      ),
    [githubFailureIsResolved, minimumConnectionsReady, suggestedReplies],
  );
  const supportFlowActive =
    supportFlow.step === "email" ||
    supportFlow.step === "subject" ||
    supportFlow.step === "message" ||
    supportFlow.step === "review";
  const supportSubjectIsOptional = supportFlow.step === "subject";
  const composerHasRequiredValue =
    supportSubjectIsOptional || Boolean(draft.trim());
  const composerPlaceholder =
    supportFlow.step === "email"
      ? "Enter your reply email..."
      : supportFlow.step === "subject"
        ? "Add a subject (optional)..."
        : supportFlow.step === "message"
          ? "Type your message to support..."
          : hasCompanyCandidate
            ? "Or send a different company URL..."
            : hasProductBrief
              ? "Ask to connect a source..."
              : hasSavedCompanyUrl
                ? "Send another URL or describe your company..."
                : "Enter company URL...";
  const composerLabel =
    supportFlow.step === "email"
      ? "Reply email"
      : supportFlow.step === "subject"
        ? "Support message subject"
        : supportFlow.step === "message"
          ? "Support message"
          : "Onboarding message";
  const showStarters = useMemo(
    () =>
      Boolean(
        state &&
          !hasProductBrief &&
          state.messages.filter((message) => message.role === "user").length === 0 &&
          suggestedReplies.length > 0,
      ),
    [hasProductBrief, state, suggestedReplies.length],
  );

  async function sendMessage(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    shouldFollowConversationRef.current = true;
    setBusy("chat");
    setError(null);
    setDraft("");
    setSuggestedReplies([]);
    try {
      const payload = (await onboardingFetch(orgId, "POST", message)) as OnboardingState & {
        suggestedActions?: OnboardingAction[];
        suggestedReplies?: string[];
      };
      setState(payload);
      setActions(payload.suggestedActions ?? []);
      setSuggestedReplies(payload.suggestedReplies ?? []);
    } catch {
      setError(FRIENDLY_ERROR);
      setDraft(message);
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  async function continueOnboarding() {
    if (busy || !minimumConnectionsReady) return;
    setBusy("continue");
    setError(null);
    try {
      await onboardingActionFetch(orgId, "continue");
      router.push("/overview");
      router.refresh();
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function continueWithoutGithub() {
    if (busy) return;
    setBusy("continue_without_github");
    setError(null);
    try {
      await onboardingActionFetch(orgId, "continue");
      router.push("/overview");
      router.refresh();
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function refreshGithubConnection() {
    if (busy) return;
    setBusy("refresh_github");
    setError(null);
    setGithubRecoveryNotice(null);
    try {
      const next = await workspaceSetupFetch(orgId);
      setSetupStatus(next);
      setConnectedIds(next.connectedIntegrationIds);
      if (!next.githubConnected) {
        setGithubRecoveryNotice(
          "GitHub has not linked this installation to the workspace yet. You can continue now and reconnect later from Integrations.",
        );
      }
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
    }
  }

  function startSupportFlow() {
    if (busy) return;
    setSupportFlow({
      step: "email",
      replyEmail: loginEmail,
      subject: "",
      message: "",
    });
    setDraft(loginEmail);
    setError(null);
    setSupportDeliveryError(null);
    setSuggestedReplies([]);
    recordActivityExchange(
      "Contact support",
      "Contact support",
      loginEmail
        ? "Confirm or change the email support should reply to."
        : "What email should support reply to?",
    );
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function cancelSupportFlow() {
    setSupportFlow({
      step: "idle",
      replyEmail: "",
      subject: "",
      message: "",
    });
    setDraft("");
    setError(null);
    setSupportDeliveryError(null);
    recordActivityExchange(
      "Cancel support message",
      "Support message canceled",
      "You can continue connecting sources here.",
    );
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submitSupportStep(raw: string) {
    const value = raw.trim();
    if (supportFlow.step === "email") {
      if (!REPLY_EMAIL_PATTERN.test(value) || value.length > 254) {
        setError("Enter a valid reply email.");
        return;
      }
      setSupportFlow((current) => ({
        ...current,
        step: "subject",
        replyEmail: value,
      }));
      setDraft("");
      setError(null);
      recordActivityExchange(
        value,
        "Reply email saved",
        "Add a subject, or skip this step.",
      );
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (supportFlow.step === "subject") {
      if (value.length > 160) {
        setError("Keep the subject under 160 characters.");
        return;
      }
      setSupportFlow((current) => ({
        ...current,
        step: "message",
        subject: value,
      }));
      setDraft("");
      setError(null);
      recordActivityExchange(
        value || "Skip subject",
        value ? "Subject saved" : "No subject added",
        "",
        "What would you like support to help with?",
      );
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (supportFlow.step !== "message") return;
    if (!value) {
      setError("Enter a message for support.");
      return;
    }
    if (value.length > 5_000) {
      setError("Keep the support message under 5,000 characters.");
      return;
    }
    setSupportFlow((current) => ({
      ...current,
      step: "review",
      message: value,
    }));
    setDraft("");
    setError(null);
    recordActivityExchange(
      value,
      "Review your message",
      `Check the details, then send it to ${SUPPORT_EMAIL}.`,
    );
  }

  function editSupportMessage() {
    if (busy || supportFlow.step !== "review") return;
    setSupportFlow((current) => ({ ...current, step: "message" }));
    setDraft(supportFlow.message);
    setError(null);
    setSupportDeliveryError(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function sendReviewedSupportMessage() {
    if (busy || supportFlow.step !== "review") return;
    setBusy("support");
    setError(null);
    setSupportDeliveryError(null);
    try {
      await sendSupportRequest(orgId, {
        replyEmail: supportFlow.replyEmail,
        subject: supportFlow.subject,
        message: supportFlow.message,
      });
      setSupportDeliveryError(null);
      setSupportFlow((current) => ({ ...current, step: "sent" }));
      recordActivityExchange(
        "Send to support",
        "Message sent",
        `Sent to ${SUPPORT_EMAIL}. Replies will go to ${supportFlow.replyEmail}. You can continue connecting sources while support follows up.`,
      );
    } catch {
      setSupportDeliveryError(
        "Nothing was sent. Try again now, or continue onboarding and try later.",
      );
    } finally {
      setBusy(null);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      supportFlow.step === "email" ||
      supportFlow.step === "subject" ||
      supportFlow.step === "message"
    ) {
      await submitSupportStep(draft);
      return;
    }
    if (SUPPORT_REQUEST_PATTERN.test(draft.trim())) {
      startSupportFlow();
      return;
    }
    await sendMessage(draft);
  }

  async function confirmCompanyProfile() {
    if (busy) return;
    const previousState = state;
    const confirmedProductName = state?.productProfile.productName?.trim();
    setBusy("confirm_company");
    setError(null);
    if (state && confirmedProductName) {
      setState({
        ...state,
        messages: [
          ...state.messages,
          {
            role: "user",
            content: `Confirmed ${confirmedProductName}`,
            at: new Date().toISOString(),
          },
        ],
      });
    }
    try {
      const payload = (await onboardingActionFetch(
        orgId,
        "confirm_company",
      )) as OnboardingState & {
        suggestedActions?: OnboardingAction[];
        suggestedReplies?: string[];
        organizationName?: string;
      };
      setState(payload);
      setActions(payload.suggestedActions ?? []);
      setSuggestedReplies(payload.suggestedReplies ?? []);
      router.refresh();
    } catch {
      setState(previousState);
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  async function restartCompanyProfile() {
    if (busy) return;
    setBusy("restart_company");
    setError(null);
    try {
      const payload = (await onboardingActionFetch(
        orgId,
        "restart_company",
      )) as OnboardingState;
      setState(payload);
      setActions([]);
      setSuggestedReplies([]);
      setDraft("");
    } catch {
      setError(FRIENDLY_ERROR);
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  function recordActivityExchange(
    userAction: string,
    assistantTitle: string,
    assistantMessage: string,
    assistantFollowUp?: string,
  ) {
    shouldFollowConversationRef.current = true;
    setActivityMessages((previous) => {
      const exchangeLength = assistantFollowUp ? 3 : 2;
      const lastUser = previous.at(-exchangeLength);
      const lastAssistant = previous.at(-1);
      if (
        lastUser?.content === userAction &&
        lastAssistant?.content === (assistantFollowUp ?? assistantMessage)
      ) {
        return previous;
      }
      const exchangeId = crypto.randomUUID();
      const at = new Date().toISOString();
      return [
        ...previous,
        {
          id: `${exchangeId}-user`,
          role: "user",
          content: userAction,
          at,
        },
        {
          id: `${exchangeId}-assistant`,
          role: "assistant",
          title: assistantTitle,
          content: assistantMessage,
          at,
        },
        ...(assistantFollowUp
          ? [
              {
                id: `${exchangeId}-assistant-follow-up`,
                role: "assistant" as const,
                content: assistantFollowUp,
                at,
              },
            ]
          : []),
      ];
    });
  }

  function recordPipedreamConnection(
    connector: OnboardingState["recommendedConnectors"][number],
    integrationId: string,
  ) {
    setConnectedIds((previous) =>
      previous.includes(integrationId)
        ? previous
        : [...previous, integrationId],
    );
    setConnectionStates((previous) => ({
      ...previous,
      [integrationId]: "Connected",
    }));
    setSyncRefreshKeys((previous) => ({
      ...previous,
      [integrationId]: (previous[integrationId] ?? 0) + 1,
    }));
    setSuggestedReplies([]);
    recordActivityExchange(
      `Connect ${connector.provider}`,
      `${connector.provider} is connected`,
      isFeedbackSourceIntegration(connector.integrationId)
        ? "Import starts automatically."
        : "Ready for approved actions.",
    );
    void workspaceSetupFetch(orgId)
      .then((next) => {
        setSetupStatus(next);
        setConnectedIds(next.connectedIntegrationIds);
      })
      .catch(() => undefined);
  }

  async function runAction(action: OnboardingAction) {
    setBusy(action.type);
    setError(null);
    try {
      if (action.type === "connect_webhook") {
        const result = await integrationFetch("/api/integrations/webhook", orgId);
        setWebhookUrl(result.webhookUrl as string);
        setWebhookSecret(result.signingSecret as string);
        setConnectedIds((prev) =>
          prev.includes("int_webhook") ? prev : [...prev, "int_webhook"],
        );
        setSetupStatus((previous) => ({
          ...previous,
          feedbackConnected: true,
          connectedIntegrationIds: previous.connectedIntegrationIds.includes(
            "int_webhook",
          )
            ? previous.connectedIntegrationIds
            : [...previous.connectedIntegrationIds, "int_webhook"],
        }));
        setSuggestedReplies([]);
        recordActivityExchange(
          "Connect custom webhook",
          "Webhook connected",
          "Send feedback to the new endpoint.",
        );
      }
      if (action.type === "connect_github") {
        const result = await integrationFetch("/api/integrations/github", orgId, {
          returnTo: "/onboarding",
        });
        window.location.assign(result.installUrl as string);
        recordActivityExchange(
          "Select GitHub repositories",
          "Select repositories",
          "Choose repositories. You’ll return here automatically.",
        );
      }
      router.refresh();
    } catch {
      setError(FRIENDLY_ERROR);
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
    <motion.section
      className="delphi-onboarding delphi-motion-enabled"
      initial={
        prefersReducedMotion
          ? false
          : { opacity: 0.92, filter: "blur(6px)" }
      }
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="delphi-glow" aria-hidden="true" />

      <motion.div
        className="delphi-stage-shell"
        layout
        initial={prefersReducedMotion ? false : { y: 18, scale: 0.992 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="delphi-stage" ref={stageRef}>
        {error && (
          <div className="delphi-soft-error" role="status">
            <p>{error}</p>
            <button type="button" className="text-link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <motion.div className="delphi-thread" ref={conversationRef} layout>
          <AnimatePresence initial={false}>
          {!state ? (
            error ? (
              <div className="onboarding-load-fallback" role="status">
                <strong>Chat unavailable.</strong>
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      setError(null);
                      setLoadVersion((current) => current + 1);
                    }}
                  >
                    Retry chat
                  </button>
                  <Link className="btn" href="/integrations">
                    Open integrations
                  </Link>
                </div>
              </div>
            ) : (
              <div className="onboarding-loading">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <span>Loading onboarding...</span>
              </div>
            )
          ) : (
            displayMessages.map((message, index) => {
              const formattedTime = messageTime(message.at);
              const isCompanyConfirmation =
                message.role === "user" && message.content.startsWith("Confirmed ");
              const followsCompanyConfirmation =
                message.role === "assistant" &&
                index > 0 &&
                displayMessages[index - 1]?.role === "user" &&
                displayMessages[index - 1]?.content.startsWith("Confirmed ");
              return (
              <motion.div
                key={`${message.at}-${index}`}
                className={`delphi-message-row ${message.role}${
                  isCompanyConfirmation || followsCompanyConfirmation
                    ? " delphi-confirmation-message"
                    : ""
                }`}
                layout
                initial={
                  prefersReducedMotion
                    ? false
                    : {
                        opacity: 0,
                        x: message.role === "user" ? 18 : -18,
                        y: 8,
                      }
                }
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                {message.role === "assistant" && (
                  <span className="delphi-message-sender">Operations Manager</span>
                )}
                <div className="delphi-message-body">
                  {message.role === "assistant" && <OperationsManagerAvatar />}
                  <div className={`delphi-bubble ${message.role}`}>
                    {followsCompanyConfirmation ? (
                      <div className="delphi-confirmed-site-summary">
                        <p>
                          <strong>{state.productProfile.productName}</strong> is
                          confirmed.
                          {confirmedSiteDescription
                            ? ` ${confirmedSiteDescription}`
                            : ""}
                        </p>
                        {state.productProfile.productUrl && (
                          <a
                            href={state.productProfile.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {companyHost(state.productProfile.productUrl) ??
                              state.productProfile.productUrl}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </div>
                {formattedTime && (
                  <time
                    className="delphi-message-time"
                    dateTime={message.at}
                    suppressHydrationWarning
                  >
                    {formattedTime}
                  </time>
                )}
              </motion.div>
              );
            })
          )}
          {state && showSourceStage && (
            <motion.section
              className="delphi-github-connected"
              aria-labelledby="github-connected-title"
              role="status"
              layout
              initial={
                prefersReducedMotion
                  ? false
                  : { opacity: 0, y: 12, scale: 0.992 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="delphi-github-connected-icon" aria-hidden="true">
                <IntegrationProviderIcon
                  integrationId="int_github"
                  size={24}
                  compact
                />
              </span>
              <div className="delphi-github-connected-copy">
                <h2 id="github-connected-title">GitHub connected</h2>
                <p>
                  {githubRepositoryCount > 0
                    ? `${githubRepositoryCount} ${githubRepositoryCount === 1 ? "repository is" : "repositories are"} connected and being prepared.`
                    : "Selected repositories are connected and being prepared."}
                </p>
              </div>
              <Link className="btn" href="/integrations?focus=int_github">
                Manage repositories
              </Link>
            </motion.section>
          )}
          {state && showSourceStage && (
            <RepositoryContextProgress orgId={orgId} />
          )}
          {state && showSourceStage && (
            <RepositoryActivationProgress orgId={orgId} />
          )}
          {state && showSourceStage && !minimumConnectionsReady && (
            <motion.div
              className="delphi-message-row assistant delphi-source-cue"
              layout
              initial={prefersReducedMotion ? false : { opacity: 0, x: -18, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="delphi-message-sender">Operations Manager</span>
              <div className="delphi-message-body">
                <OperationsManagerAvatar />
                <div className="delphi-bubble assistant">
                  <p>Next, connect one feedback source.</p>
                </div>
              </div>
            </motion.div>
          )}
          {activityMessages.map((message) => (
            <motion.div
              className={`delphi-message-row ${message.role} delphi-onboarding-action-message`}
              key={message.id}
              layout
              initial={
                prefersReducedMotion
                  ? false
                  : {
                      opacity: 0,
                      x: message.role === "user" ? 18 : -18,
                      y: 8,
                    }
              }
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {message.role === "assistant" && (
                <span className="delphi-message-sender">Operations Manager</span>
              )}
              <div className="delphi-message-body">
                {message.role === "assistant" && <OperationsManagerAvatar />}
                <div className={`delphi-bubble ${message.role}`}>
                  {message.title && <strong>{message.title}</strong>}
                  {message.content && <p>{message.content}</p>}
                </div>
              </div>
              <time
                className="delphi-message-time"
                dateTime={message.at}
                suppressHydrationWarning
              >
                {messageTime(message.at)}
              </time>
            </motion.div>
          ))}
          {state && minimumConnectionsReady && (
            <motion.div
              className="delphi-message-row assistant delphi-source-cue"
              layout
              initial={prefersReducedMotion ? false : { opacity: 0, x: -18, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="delphi-message-sender">Operations Manager</span>
              <div className="delphi-message-body">
                <OperationsManagerAvatar />
                <div className="delphi-bubble assistant">
                  <p>Continue for now, or connect more sources?</p>
                </div>
              </div>
            </motion.div>
          )}
          {busy === "chat" && (
            <motion.div
              className="delphi-message-row assistant"
              layout
              initial={prefersReducedMotion ? false : { opacity: 0, x: -14, y: 6 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="delphi-message-sender">Operations Manager</span>
              <div className="delphi-message-body">
                <OperationsManagerAvatar />
                <div className="delphi-bubble assistant thinking">
                  <p>
                    <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    Preparing...
                  </p>
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {busy === "chat"
            ? "The Operations Manager is preparing a response."
            : minimumConnectionsReady
              ? "GitHub and one feedback source are connected. Continue for now, or connect more sources."
              : showSourceStage
              ? "GitHub is connected. Next, connect one feedback source."
            : state?.messages.at(-1)?.role === "assistant"
              ? state.messages.at(-1)?.content
              : ""}
        </p>

        {state && hasCompanyCandidate && (
          <motion.section
            className="delphi-company-confirmation"
            aria-labelledby="company-confirmation-title"
            layout
            initial={
              prefersReducedMotion
                ? false
                : { opacity: 0, y: 18, clipPath: "inset(0 0 12% 0 round 16px)" }
            }
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0 round 16px)" }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="delphi-company-identity">
              <div className="delphi-company-logo" aria-hidden="true">
                {state.productProfile.companyLogo ? (
                  <Image
                    src={state.productProfile.companyLogo}
                    alt=""
                    width={48}
                    height={48}
                    unoptimized
                  />
                ) : (
                  <Building2 size={22} />
                )}
              </div>
              <div>
                <span className="delphi-bubble-label">Confirm company</span>
                <h2 id="company-confirmation-title">
                  {state.productProfile.productName}
                </h2>
                {state.productProfile.productUrl && (
                  <a
                    href={state.productProfile.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {companyHost(state.productProfile.productUrl) ?? state.productProfile.productUrl}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
            {confirmedSiteDescription && (
              <p>{confirmedSiteDescription}</p>
            )}
            <div className="delphi-company-actions">
              <button
                className="btn"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void restartCompanyProfile()}
              >
                Use another URL
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void confirmCompanyProfile()}
              >
                {busy === "confirm_company" ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <Check size={14} aria-hidden="true" />
                )}
                {busy === "confirm_company" ? "Confirming..." : "Confirm company"}
              </button>
            </div>
            <AnimatePresence initial={false}>
              {busy === "confirm_company" && (
                <CompanyConfirmationProgress
                  reducedMotion={prefersReducedMotion}
                />
              )}
            </AnimatePresence>
          </motion.section>
        )}

        {state && hasProductBrief && !githubConnected && (
          <motion.section
            className="delphi-next-step delphi-confirmation-reveal reveal-next-step"
            aria-labelledby="github-next-step-title"
            layout
            initial={
              prefersReducedMotion
                ? false
                : { opacity: 0, y: 16, scale: 0.99 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="delphi-next-step-icon" aria-hidden="true">
              <IntegrationProviderIcon
                integrationId="int_github"
                size={22}
                compact
              />
            </div>
            <div className="delphi-next-step-copy">
              <span>NEXT BEST STEP</span>
              <h2 id="github-next-step-title">
                {githubCallbackStatus === "error"
                  ? "GitHub needs to be linked"
                  : githubInstalled
                    ? "Choose repositories"
                    : "Connect GitHub"}
              </h2>
              <p>
                {githubCallbackStatus === "error"
                  ? GITHUB_CALLBACK_ERRORS[githubCallbackReason ?? ""] ??
                    GITHUB_CALLBACK_ERRORS.connection_failed
                  : githubInstalled
                    ? "GitHub is connected. Select only the repositories that belong to this workspace; CloseSpan will not index the others."
                    : "Connect GitHub, then choose the repositories this workspace may inspect and use for approved PRs."}
              </p>
              {githubRecoveryNotice && (
                <p className="delphi-next-step-notice" role="status">
                  {githubRecoveryNotice}
                </p>
              )}
            </div>
            <div className="delphi-next-step-actions">
              {githubInstalled ? (
                <Link className="btn primary" href="/integrations?view=connections&focus=int_github&select=repositories">
                  Choose repositories
                </Link>
              ) : (
                <button
                  className="btn primary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction({
                      type: "connect_github",
                      label: "Connect GitHub",
                    })
                  }
                >
                  {busy === "connect_github" ? "Opening..." : "Connect GitHub"}
                </button>
              )}
              <button
                className="btn"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void refreshGithubConnection()}
              >
                {busy === "refresh_github" ? "Checking..." : "Check again"}
              </button>
              <button
                className="text-link delphi-next-step-skip"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void continueWithoutGithub()}
              >
                {busy === "continue_without_github"
                  ? "Opening workspace..."
                  : "Continue to workspace"}
              </button>
            </div>
          </motion.section>
        )}

        {state && showSourceStage && setupStatus.feedbackConnected && (
          <motion.div
            className="delphi-message-row assistant delphi-product-message delphi-confirmation-reveal reveal-product"
            layout
            initial={prefersReducedMotion ? false : { opacity: 0, x: -18, y: 10 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="delphi-message-sender">Operations Manager</span>
            <div className="delphi-message-body">
              <OperationsManagerAvatar />
              <PublicSourceDiscovery
                key={JSON.stringify([
                  state.productProfile.productName,
                  state.productProfile.productUrl,
                  state.productProfile.productDescription,
                ])}
                orgId={orgId}
                productProfile={state.productProfile}
              />
            </div>
          </motion.div>
        )}

        {state && showSourceStage && feedbackConnectors.length > 0 && (
          <motion.section
            className="delphi-sync delphi-confirmation-reveal reveal-connectors"
            id="intake-sources"
            layout
            initial={
              prefersReducedMotion
                ? false
                : { opacity: 0, y: 18, clipPath: "inset(0 0 10% 0 round 16px)" }
            }
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0 round 16px)" }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="delphi-sync-head">
              <PlugZap size={18} aria-hidden="true" />
              <div>
                <strong>Connect feedback</strong>
                <p>Choose one source.</p>
              </div>
              <div
                className="delphi-sync-source-icons"
                aria-label="Quick connect feedback sources"
              >
                {feedbackConnectors
                  .filter((connector) => {
                    const observedConnectionState =
                      connectionStates[connector.integrationId];
                    const connected =
                      observedConnectionState === undefined
                        ? connectedIds.includes(connector.integrationId)
                        : observedConnectionState === "Connected";
                    return !connected && isIntegrationAvailable(connector.integrationId);
                  })
                  .slice(0, 4)
                  .map((connector) => {
                    const observedConnectionState =
                      connectionStates[connector.integrationId];
                    const pipedreamIntegrationId = isPipedreamConnectorId(
                      connector.integrationId,
                    )
                      ? connector.integrationId
                      : null;
                    const icon = (
                      <IntegrationProviderIcon
                        integrationId={connector.integrationId}
                        size={18}
                        compact
                      />
                    );

                    if (pipedreamIntegrationId) {
                      return (
                        <PipedreamConnectButton
                          key={connector.integrationId}
                          orgId={orgId}
                          integrationId={pipedreamIntegrationId}
                          className="delphi-sync-source-shortcut"
                          connectionState={observedConnectionState}
                          showGuidance={false}
                          showStatusDetails={false}
                          leadingIcon={icon}
                          iconOnly
                          ariaLabel={`Connect ${connector.provider}`}
                          onConnected={(integrationId) =>
                            recordPipedreamConnection(connector, integrationId)
                          }
                        />
                      );
                    }

                    if (connector.integrationId === "int_webhook") {
                      const opening = busy === "connect_webhook";
                      return (
                        <button
                          key={connector.integrationId}
                          className="delphi-sync-source-shortcut"
                          type="button"
                          aria-label="Connect Custom webhook"
                          title="Connect Custom webhook"
                          disabled={opening}
                          onClick={() =>
                            void runAction({
                              type: "connect_webhook",
                              label: "Create webhook endpoint",
                            })
                          }
                        >
                          {opening ? (
                            <LoaderCircle
                              className="spin"
                              size={16}
                              aria-hidden="true"
                            />
                          ) : (
                            icon
                          )}
                        </button>
                      );
                    }

                    return null;
                  })}
              </div>
            </div>
            <div className="delphi-sync-grid">
              {feedbackConnectors.map((connector) => {
                const githubConnector = false;
                const observedConnectionState =
                  connectionStates[connector.integrationId];
                const connected = githubConnector
                  ? setupStatus.githubConnected
                  : observedConnectionState === undefined
                    ? connectedIds.includes(connector.integrationId)
                    : observedConnectionState === "Connected";
                const pipedreamIntegrationId =
                  !githubConnector && isPipedreamConnectorId(connector.integrationId)
                    ? connector.integrationId
                    : null;
                const feedbackSource = isFeedbackSourceIntegration(
                  connector.integrationId,
                );
                const available = isIntegrationAvailable(
                  connector.integrationId,
                );
                const action =
                  actions.find((item) => {
                    if (item.type === "connect_webhook")
                      return connector.integrationId === "int_webhook";
                    if (item.type === "connect_github")
                      return connector.integrationId === "int_github";
                    if (item.type === "oauth_connect")
                      return item.integrationId === connector.integrationId;
                    return false;
                  }) ??
                  (connector.integrationId === "int_webhook"
                    ? ({
                        type: "connect_webhook",
                        label: "Create webhook endpoint",
                      } satisfies OnboardingAction)
                    : connector.integrationId === "int_github"
                      ? ({
                          type: "connect_github",
                          label: "Connect GitHub",
                        } satisfies OnboardingAction)
                      : null);

                return (
                  <motion.article
                    key={connector.integrationId}
                    className={`delphi-source${connected ? " connected" : ""}`}
                    data-connector-id={connector.integrationId}
                    layout
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div>
                      <div className="delphi-source-title">
                        <IntegrationProviderIcon
                          integrationId={connector.integrationId}
                          size={18}
                          compact
                        />
                        <div>
                          <span className="delphi-source-priority">
                            {feedbackSource ? connector.priority : "optional"}
                          </span>
                          <h3>{connector.provider}</h3>
                        </div>
                      </div>
                      <p>{
                        githubConnector
                          ? connected
                            ? "Selected repositories are ready for approved engineering actions."
                            : "Select only the repositories this workspace may inspect, test, and use for pull requests."
                          : compactActionText(connector.reason)
                      }</p>
                    </div>
                    {connected ? (
                      <div className="delphi-source-connected">
                        {pipedreamIntegrationId && feedbackSource ? (
                          <IntegrationSyncStatus
                            orgId={orgId}
                            integrationId={pipedreamIntegrationId}
                            active
                            refreshKey={syncRefreshKeys[pipedreamIntegrationId] ?? 0}
                            onSucceeded={() => router.refresh()}
                            onConnectionStateChange={(nextState) => {
                              setConnectionStates((previous) => ({
                                ...previous,
                                [pipedreamIntegrationId]: nextState,
                              }));
                            }}
                          />
                        ) : (
                          <span className="delphi-source-status">
                            <Check size={14} aria-hidden="true" /> Connected
                          </span>
                        )}
                      </div>
                    ) : !available ? (
                      <div className="delphi-source-unavailable">
                        <span>Coming soon</span>
                        <p>Choose another source.</p>
                      </div>
                    ) : pipedreamIntegrationId ? (
                      <PipedreamConnectButton
                        orgId={orgId}
                        integrationId={pipedreamIntegrationId}
                        guidance="compact"
                        connectionState={observedConnectionState}
                        onConnected={(integrationId) =>
                          recordPipedreamConnection(connector, integrationId)
                        }
                      />
                    ) : action?.type === "oauth_connect" ? (
                      <Link
                        className="btn"
                        href={`/integrations?focus=${action.integrationId}`}
                      >
                        Connect
                      </Link>
                    ) : action ? (
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy === action.type}
                        onClick={() => void runAction(action)}
                      >
                        {busy === action.type ? "Opening..." : "Connect"}
                      </button>
                    ) : null}
                  </motion.article>
                );
              })}
            </div>
          </motion.section>
        )}

        {showComposer &&
          supportFlow.step !== "review" &&
          (supportFlowActive ||
            showStarters ||
            orderedSuggestedReplies.length > 0 ||
            supportFlow.step === "idle" ||
            supportFlow.step === "sent") && (
          <motion.div
            className="delphi-chips"
            aria-label={supportFlowActive ? "Support message actions" : "Suggested replies"}
            layout
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {!supportFlowActive &&
              (showStarters ? STARTER_CHIPS : orderedSuggestedReplies).map((chip) => (
              <motion.button
                key={chip}
                type="button"
                className={`delphi-chip${
                  chip === "Connect Apple App Store"
                    ? " delphi-app-store-chip"
                    : ""
                }`}
                disabled={Boolean(busy)}
                onClick={() =>
                  chip === "Continue for now"
                    ? void continueOnboarding()
                    : void sendMessage(chip)
                }
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                {chip === "Connect Apple App Store" && (
                  <IntegrationProviderIcon
                    integrationId="int_app_store"
                    size={16}
                    compact
                  />
                )}
                {chip === "Connect Apple App Store"
                  ? "Connect App Store"
                  : chip}
              </motion.button>
            ))}
            {!supportFlowActive && (
              <motion.button
                type="button"
                className="delphi-chip delphi-support-chip"
                disabled={Boolean(busy)}
                onClick={startSupportFlow}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                <Mail size={16} aria-hidden="true" />
                Contact support
              </motion.button>
            )}
            {supportFlow.step === "subject" && (
              <motion.button
                type="button"
                className="delphi-chip"
                disabled={Boolean(busy)}
                onClick={() => void submitSupportStep("")}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                Skip subject
              </motion.button>
            )}
            {supportFlowActive && (
              <motion.button
                type="button"
                className="delphi-chip"
                disabled={Boolean(busy)}
                onClick={cancelSupportFlow}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                Cancel
              </motion.button>
            )}
          </motion.div>
        )}

        {showComposer && supportFlow.step === "review" && (
          <motion.section
            className="delphi-support-review"
            aria-labelledby="support-review-title"
            layout
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="delphi-support-review-heading">
              <span className="delphi-support-review-icon" aria-hidden="true">
                <Mail size={20} />
              </span>
              <div>
                <h2 id="support-review-title">Send to support</h2>
                <p>{SUPPORT_EMAIL}</p>
              </div>
            </div>
            <dl className="delphi-support-review-details">
              <div>
                <dt>Reply email</dt>
                <dd>{supportFlow.replyEmail}</dd>
              </div>
              <div>
                <dt>Subject</dt>
                <dd>{supportFlow.subject || "No subject"}</dd>
              </div>
              <div>
                <dt>Message</dt>
                <dd>{supportFlow.message}</dd>
              </div>
            </dl>
            <AnimatePresence initial={false}>
              {supportDeliveryError && (
                <motion.div
                  className="delphi-support-delivery-error"
                  role="alert"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  <CircleAlert size={20} aria-hidden="true" />
                  <div>
                    <strong>Message not sent</strong>
                    <p>{supportDeliveryError}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="delphi-support-review-actions">
              <button
                className="btn"
                type="button"
                disabled={Boolean(busy)}
                onClick={editSupportMessage}
              >
                Edit message
              </button>
              <button
                className="btn"
                type="button"
                disabled={Boolean(busy)}
                onClick={cancelSupportFlow}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={busy === "support"}
                onClick={() => void sendReviewedSupportMessage()}
              >
                {busy === "support" ? (
                  <LoaderCircle size={18} className="spin" aria-hidden="true" />
                ) : (
                  <Mail size={18} aria-hidden="true" />
                )}
                {busy === "support"
                  ? "Sending..."
                  : supportDeliveryError
                    ? "Try sending again"
                    : "Send to support"}
              </button>
            </div>
          </motion.section>
        )}

        {(webhookUrl || webhookSecret) && (
          <motion.div
            className="delphi-credentials"
            layout
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {webhookUrl && (
              <>
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
              </>
            )}
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
          </motion.div>
        )}

        </div>

        <AnimatePresence initial={false}>
          {showComposer && supportFlow.step !== "review" && (
            <motion.form
              key="onboarding-composer"
              className="delphi-composer"
              onSubmit={onSubmit}
              layout="position"
              initial={
                prefersReducedMotion
                  ? false
                  : {
                      opacity: 0,
                      y: 18,
                      scaleY: 0.88,
                      filter: "blur(8px)",
                      clipPath: "inset(0 0 42% 0 round 18px)",
                    }
              }
              animate={{
                opacity: 1,
                y: 0,
                scaleY: 1,
                filter: "blur(0px)",
                clipPath: "inset(0 0 0% 0 round 18px)",
              }}
              exit={
                prefersReducedMotion
                  ? undefined
                  : {
                      opacity: 0,
                      y: 8,
                      scaleY: 0.96,
                      filter: "blur(4px)",
                      clipPath: "inset(0 0 28% 0 round 18px)",
                    }
              }
              transition={{
                duration: prefersReducedMotion ? 0 : 0.58,
                delay: prefersReducedMotion ? 0 : 0.14,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <input
                className="neumorphic-composite-field"
                ref={inputRef}
                type={supportFlow.step === "email" ? "email" : "text"}
                value={draft}
                aria-label={composerLabel}
                placeholder={composerPlaceholder}
                maxLength={
                  supportFlow.step === "message"
                    ? 5_000
                    : supportFlow.step === "subject"
                      ? 160
                      : undefined
                }
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy === "chat" || busy === "support"}
              />
              <motion.button
                className="delphi-send"
                type="submit"
                disabled={
                  !composerHasRequiredValue ||
                  busy === "chat" ||
                  busy === "support"
                }
                aria-label={
                  busy === "support" ? "Sending support message" : "Send message"
                }
                whileTap={
                  prefersReducedMotion ||
                  !composerHasRequiredValue ||
                  busy === "chat" ||
                  busy === "support"
                    ? undefined
                    : { scale: 0.94 }
                }
              >
                <ArrowUp size={18} aria-hidden="true" />
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}
