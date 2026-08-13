import type {
  OnboardingMessage,
  OnboardingPhase,
} from "./onboarding-repository";

export function deriveOnboardingPhase(input: {
  persistedPhase: OnboardingPhase | null;
  hasProductBrief: boolean;
  feedbackConnected: boolean;
  feedbackCount: number;
}): OnboardingPhase {
  if (input.persistedPhase === "complete") return "complete";
  if (!input.hasProductBrief) return "discover";
  if (input.feedbackCount > 0) return "complete";
  return input.feedbackConnected ? "verify" : "connect";
}

export function resolvedConnectorFailure(input: {
  provider: string;
  connected: boolean;
  messages: OnboardingMessage[];
}): boolean {
  if (!input.connected) return false;
  const latestAssistantMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.content;
  if (!latestAssistantMessage) return false;
  const escapedProvider = input.provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `${escapedProvider}[\\s\\S]{0,80}(failed|failure|access denied|timeout|reconnect)`,
    "i",
  ).test(latestAssistantMessage);
}

const CONTINUE_REPLY_PATTERN =
  /^continue(?: for now| to the workspace)?[?.!]?$/i;

export function prioritizeOnboardingContinuation(
  replies: readonly string[],
  canContinue: boolean,
): string[] {
  const connectionReplies = replies.filter(
    (reply) => !CONTINUE_REPLY_PATTERN.test(reply.trim()),
  );
  return canContinue
    ? ["Continue for now", ...connectionReplies]
    : connectionReplies;
}
