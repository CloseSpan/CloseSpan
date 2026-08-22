import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  getAiRuntimeConfiguration,
  type AiRuntimeConfiguration,
} from "./ai-config";
import {
  discoverCompanyProfile,
  extractCompanyUrl,
} from "./company-profile-discovery";
import {
  connectorCatalogForAgent,
  isFeedbackSourceIntegration,
  isIntegrationAvailable,
  type ConnectorCatalogEntry,
} from "./integration-catalog";
import { discoverFeedbackSourcesFromProduct } from "./product-source-discovery";
import type {
  OnboardingMessage,
  OnboardingPhase,
  OnboardingState,
  ProductProfile,
  RecommendedConnector,
} from "./onboarding-repository";
import { defaultOnboardingState } from "./onboarding-repository";
import { prioritizeOnboardingContinuation } from "./onboarding-guidance";

export type OnboardingAction =
  | { type: "connect_webhook"; label: string }
  | { type: "connect_github"; label: string }
  | { type: "open_settings_ai"; label: string }
  | { type: "oauth_connect"; integrationId: string; label: string };

export interface OnboardingTurnResult {
  assistantMessage: string;
  phase: OnboardingPhase;
  productProfile: ProductProfile;
  recommendedConnectors: RecommendedConnector[];
  suggestedActions: OnboardingAction[];
  suggestedReplies: string[];
}

export interface OnboardingWorkspaceConnectionStatus {
  connectedIntegrationIds: string[];
  feedbackConnected: boolean;
  githubConnected: boolean;
  aiConfigured: boolean;
  setupComplete: boolean;
}

const onboardingTurnSchema = z.object({
  assistantMessage: z.string().min(1).max(1200),
  productProfile: z.object({
    productName: z.string().nullable(),
    productUrl: z.string().nullable(),
    productDescription: z.string().nullable(),
    feedbackSources: z.array(z.string()).max(12),
    engineeringTools: z.array(z.string()).max(12),
  }),
  recommendedConnectors: z
    .array(
      z.object({
        integrationId: z.string(),
        reason: z.string().min(1).max(280),
        priority: z.enum(["required", "recommended", "optional"]),
      }),
    )
    .max(8),
  phase: z.enum(["discover", "connect", "verify", "complete"]),
  suggestedActions: z
    .array(
      z.object({
        action: z.enum([
          "connect_webhook",
          "connect_github",
          "open_settings_ai",
          "oauth_connect",
        ]),
        // Structured outputs require every field; use null when unused.
        integrationId: z.string().nullable(),
        label: z.string().min(1).max(80),
      }),
    )
    .max(6),
  suggestedReplies: z.array(z.string().min(1).max(80)).max(5),
});

const catalogById = new Map(
  connectorCatalogForAgent.map((entry) => [entry.id, entry]),
);

function enrichConnectors(
  raw: z.infer<typeof onboardingTurnSchema>["recommendedConnectors"],
): RecommendedConnector[] {
  return raw
    .map((item) => {
      const catalog = catalogById.get(item.integrationId);
      if (!catalog || !isIntegrationAvailable(catalog.id)) return null;
      return {
        integrationId: catalog.id,
        provider: catalog.provider,
        reason: item.reason,
        priority: item.priority,
        connectionMethod: catalog.connectionMethod,
      };
    })
    .filter((item): item is RecommendedConnector => item !== null);
}

function mapActions(
  raw: z.infer<typeof onboardingTurnSchema>["suggestedActions"],
  connectedIntegrationIds: ReadonlySet<string>,
  aiConfigured: boolean,
): OnboardingAction[] {
  const actions: OnboardingAction[] = [];
  const actionKeys = new Set<string>();
  const push = (action: OnboardingAction, key: string) => {
    if (actionKeys.has(key)) return;
    actionKeys.add(key);
    actions.push(action);
  };
  for (const item of raw) {
    switch (item.action) {
      case "connect_webhook":
        if (!connectedIntegrationIds.has("int_webhook")) {
          push(
            { type: "connect_webhook", label: item.label },
            "int_webhook",
          );
        }
        break;
      case "connect_github":
        if (!connectedIntegrationIds.has("int_github")) {
          push({ type: "connect_github", label: item.label }, "int_github");
        }
        break;
      case "open_settings_ai":
        if (!aiConfigured) {
          push({ type: "open_settings_ai", label: item.label }, "settings_ai");
        }
        break;
      case "oauth_connect":
        if (
          item.integrationId?.trim() &&
          isIntegrationAvailable(item.integrationId) &&
          !connectedIntegrationIds.has(item.integrationId)
        ) {
          if (item.integrationId === "int_github") {
            push(
              { type: "connect_github", label: item.label },
              "int_github",
            );
          } else {
            push(
              {
                type: "oauth_connect",
                integrationId: item.integrationId,
                label: item.label,
              },
              item.integrationId,
            );
          }
        }
        break;
    }
  }
  return actions.slice(0, 5);
}

function buildSystemPrompt(catalog: readonly ConnectorCatalogEntry[]): string {
  return [
    "You are CloseSpan's Expert Operations Manager, an autonomous ops lead inside the product.",
    "Phase rules:",
    "1) First, collect ONLY product details (name, URL if any, what it does, who uses it). Do not ask which tools they use.",
    "2) Once you have a usable product brief, set phase to connect and recommend feedback connectors inferred from the product (Discord, Zendesk, Slack, Intercom, App Store, Play Store, webhook, etc.).",
    "After company confirmation, GitHub is always the first connection. Until it is connected, explain briefly that repository selection is required for testing and approved PRs.",
    "Never ask the user to list Zendesk, Slack, or other tools. Infer sources from the product itself.",
    "Speak like a senior ops manager: decisive, calm, practical.",
    "Keep assistantMessage under 35 words. State one fact and one next action. Add explanation only when it helps recovery.",
    "Ask one focused question only while gathering product details.",
    "Always return 2-4 short suggestedReplies.",
    "The allowed catalog contains only connectors that can be connected in the current product. Never recommend anything outside it.",
    "Treat currentWorkspaceConnections in the user payload as authoritative. Never ask a user to reconnect a source already listed as connected.",
    "A connector failure must not block onboarding: recommend another available feedback source or the webhook fallback.",
    "Prefer webhook as the universal fallback.",
    "Allowed connectors JSON:",
    JSON.stringify(catalog),
  ].join("\n");
}

function hasProductBrief(profile: ProductProfile): boolean {
  return Boolean(profile.companyProfileConfirmed && profile.productName?.trim());
}

function connectedIds(
  workspaceStatus: OnboardingWorkspaceConnectionStatus,
): Set<string> {
  const ids = new Set(
    workspaceStatus.connectedIntegrationIds.filter(isIntegrationAvailable),
  );
  if (workspaceStatus.githubConnected) ids.add("int_github");
  return ids;
}

function availableRecommendations(
  connectors: readonly RecommendedConnector[],
): RecommendedConnector[] {
  const seen = new Set<string>();
  return connectors.filter((connector) => {
    if (
      !isIntegrationAvailable(connector.integrationId) ||
      seen.has(connector.integrationId)
    ) {
      return false;
    }
    seen.add(connector.integrationId);
    return true;
  });
}

function recommendedConnector(
  integrationId: string,
  reason: string,
): RecommendedConnector | null {
  const catalog = catalogById.get(integrationId);
  if (!catalog || !isIntegrationAvailable(integrationId)) return null;
  return {
    integrationId,
    provider: catalog.provider,
    reason,
    priority: "required",
    connectionMethod: catalog.connectionMethod,
  };
}

const failureAliases: ReadonlyArray<{
  integrationId: string;
  pattern: RegExp;
}> = [
  { integrationId: "int_github", pattern: /\bgithub\b/i },
  { integrationId: "int_zendesk", pattern: /\bzendesk\b/i },
  { integrationId: "int_intercom", pattern: /\bintercom\b/i },
  { integrationId: "int_slack", pattern: /\bslack\b/i },
  { integrationId: "int_discord", pattern: /\bdiscord\b/i },
  {
    integrationId: "int_app_store",
    pattern: /\b(?:apple\s+)?app\s+store\b/i,
  },
  {
    integrationId: "int_play_store",
    pattern: /\b(?:google\s+)?play\s+store\b/i,
  },
  { integrationId: "int_webhook", pattern: /\bwebhook\b/i },
];

function reportedConnectorFailure(message: string): {
  integrationId: string | null;
  label: string;
} | null {
  const failureLanguage =
    /\b(?:fail(?:ed|ing|s)?|error|broken|stuck|unable|cannot|can't|couldn't|won't|trouble)\b|\b(?:did not|didn't|does not|doesn't|not)\s+(?:connect|work|open|finish)/i;
  if (!failureLanguage.test(message)) return null;
  const matched = failureAliases.find((candidate) =>
    candidate.pattern.test(message),
  );
  if (!matched) return { integrationId: null, label: "That connector" };
  return {
    integrationId: matched.integrationId,
    label: catalogById.get(matched.integrationId)?.provider ?? "That connector",
  };
}

function feedbackFallback(input: {
  state: OnboardingState;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
  excludedIntegrationId: string | null;
}): { connector: RecommendedConnector; alreadyConnected: boolean } {
  const connected = connectedIds(input.workspaceStatus);
  const eligible = (integrationId: string) =>
    integrationId !== input.excludedIntegrationId &&
    isFeedbackSourceIntegration(integrationId);
  const preferredIds = [
    ...availableRecommendations(input.state.recommendedConnectors).map(
      (connector) => connector.integrationId,
    ),
    "int_webhook",
    "int_zendesk",
    "int_intercom",
    "int_slack",
    "int_discord",
    "int_app_store",
    "int_play_store",
  ].filter((integrationId, index, values) => values.indexOf(integrationId) === index);

  const unconnectedId = preferredIds.find(
    (integrationId) => eligible(integrationId) && !connected.has(integrationId),
  );
  const selectedId =
    unconnectedId ??
    preferredIds.find(
      (integrationId) => eligible(integrationId) && connected.has(integrationId),
    ) ??
    "int_webhook";
  const connector = recommendedConnector(
    selectedId,
    "This source keeps feedback intake moving while another connector is retried later.",
  );
  if (!connector) {
    throw new Error("The webhook fallback is unavailable");
  }
  return { connector, alreadyConnected: connected.has(selectedId) };
}

function connectorFailureTurn(input: {
  state: OnboardingState;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
  failure: NonNullable<ReturnType<typeof reportedConnectorFailure>>;
}): OnboardingTurnResult {
  const connected = connectedIds(input.workspaceStatus);
  const fallback = feedbackFallback({
    state: input.state,
    workspaceStatus: input.workspaceStatus,
    excludedIntegrationId: input.failure.integrationId,
  });
  const otherRecommendations = availableRecommendations(
    input.state.recommendedConnectors,
  ).filter(
    (connector) =>
      connector.integrationId !== input.failure.integrationId &&
      connector.integrationId !== fallback.connector.integrationId &&
      !connected.has(connector.integrationId),
  );
  const recommendedConnectors = [
    fallback.connector,
    ...otherRecommendations,
  ].slice(0, 6);
  const githubAlreadyConnected =
    input.failure.integrationId === "int_github" &&
    input.workspaceStatus.githubConnected;
  const fallbackGuidance = fallback.alreadyConnected
    ? `${fallback.connector.provider} is already connected.`
    : `Connect ${fallback.connector.provider} next.`;
  const assistantMessage = githubAlreadyConnected
    ? `GitHub is connected. ${fallbackGuidance}`
    : `${input.failure.label} failed. ${fallbackGuidance}`;
  const suggestedReplies = fallback.alreadyConnected
    ? ["Continue onboarding", "Review connected sources"]
    : [
        `Connect ${fallback.connector.provider}`,
        ...(fallback.connector.integrationId === "int_webhook"
          ? []
          : ["Use a webhook instead"]),
        "Continue without the failed connector",
      ];
  return {
    assistantMessage,
    phase: "connect",
    productProfile: input.state.productProfile,
    recommendedConnectors,
    suggestedActions: buildSuggestedActions(
      recommendedConnectors,
      connected,
      input.workspaceStatus.aiConfigured,
    ),
    suggestedReplies,
  };
}

function conversationPayload(
  firstName: string,
  organizationName: string,
  state: OnboardingState,
  userMessage: string,
  workspaceStatus: OnboardingWorkspaceConnectionStatus,
) {
  return JSON.stringify({
    workspace: organizationName,
    userFirstName: firstName,
    currentPhase: state.phase,
    existingProfile: state.productProfile,
    currentWorkspaceConnections: workspaceStatus,
    priorMessages: state.messages.slice(-12),
    latestUserMessage: userMessage,
  });
}

async function callOpenAiCompatible(
  configuration: AiRuntimeConfiguration,
  systemPrompt: string,
  payload: string,
) {
  const client = new OpenAI({
    apiKey: configuration.apiKey!,
    baseURL: configuration.baseUrl,
    timeout: configuration.timeoutMs,
    maxRetries: 2,
  });
  const response = await client.chat.completions.parse({
    model: configuration.model,
    max_completion_tokens: configuration.maxOutputTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: payload },
    ],
    response_format: zodResponseFormat(onboardingTurnSchema, "onboarding_turn_v1"),
  });
  const parsed = response.choices[0]?.message.parsed;
  if (!parsed) throw new Error("AI returned no onboarding plan");
  return parsed;
}

async function callAnthropicOnboarding(
  configuration: AiRuntimeConfiguration,
  systemPrompt: string,
  payload: string,
) {
  const client = new Anthropic({
    apiKey: configuration.apiKey!,
    baseURL: configuration.baseUrl,
    timeout: configuration.timeoutMs,
    maxRetries: 2,
  });
  const response = await client.messages.parse({
    model: configuration.model,
    max_tokens: configuration.maxOutputTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: payload }],
    output_config: { format: zodOutputFormat(onboardingTurnSchema) },
  });
  if (!response.parsed_output) throw new Error("AI returned no onboarding plan");
  return response.parsed_output;
}

async function productDiscoveryTurn(input: {
  orgId: string;
  productBrief: string;
  existingProfile: ProductProfile;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
}): Promise<OnboardingTurnResult> {
  const discovery = await discoverFeedbackSourcesFromProduct({
    orgId: input.orgId,
    productBrief: input.productBrief,
  });
  const productProfile: ProductProfile = {
    ...input.existingProfile,
    ...discovery.productProfile,
  };
  const connected = connectedIds(input.workspaceStatus);
  let recommendedConnectors = availableRecommendations(
    discovery.recommendedConnectors,
  ).slice(0, 6);
  if (!recommendedConnectors.some((connector) => connector.integrationId === "int_github")) {
    const github = recommendedConnector(
      "int_github",
      "Select the repositories CloseSpan may inspect, test, and use for approved pull requests.",
    );
    if (github) recommendedConnectors = [github, ...recommendedConnectors].slice(0, 6);
  }
  if (
    !recommendedConnectors.some((connector) =>
      isFeedbackSourceIntegration(connector.integrationId),
    ) &&
    !input.workspaceStatus.feedbackConnected
  ) {
    const webhook = recommendedConnector(
      "int_webhook",
      "Custom webhook is the available fallback for first-party feedback intake.",
    );
    if (webhook) recommendedConnectors = [webhook, ...recommendedConnectors];
  }
  return {
    assistantMessage: "Choose a feedback source to start intake.",
    phase: "connect",
    productProfile,
    recommendedConnectors,
    suggestedActions: buildSuggestedActions(
      recommendedConnectors,
      connected,
      input.workspaceStatus.aiConfigured,
    ),
    suggestedReplies: [
      "Connect the recommended sources",
      "Start with a webhook only",
      "Tell me why you picked these",
    ],
  };
}

async function companyProfileCandidateTurn(input: {
  orgId: string;
  message: string;
  existingProfile: ProductProfile;
}, discoverCompany: typeof discoverCompanyProfile = discoverCompanyProfile): Promise<OnboardingTurnResult> {
  const companyUrl = extractCompanyUrl(input.message);
  if (companyUrl) {
    try {
      const company = await discoverCompany(companyUrl);
      return {
        assistantMessage: "Here’s what I found.",
        phase: "discover",
        productProfile: {
          ...input.existingProfile,
          productName: company.name,
          productUrl: company.url,
          productDescription:
            company.description ?? input.existingProfile.productDescription,
          companyLogo: company.logo,
          companyProfileConfirmed: false,
          companyProfileReadyForConfirmation: true,
        },
        recommendedConnectors: [],
        suggestedActions: [],
        suggestedReplies: [],
      };
    } catch {
      return {
        assistantMessage:
          "Site unavailable. Check the URL or describe the company.",
        phase: "discover",
        productProfile: input.existingProfile,
        recommendedConnectors: [],
        suggestedActions: [],
        suggestedReplies: ["We don't have a website yet"],
      };
    }
  }

  if (/\b(?:don't|do not|no)\b.{0,24}\b(?:website|site|url)\b/i.test(input.message)) {
    return {
      assistantMessage:
        "Send the company name, what it does, and who it serves.",
      phase: "discover",
      productProfile: input.existingProfile,
      recommendedConnectors: [],
      suggestedActions: [],
      suggestedReplies: [],
    };
  }

  if (!looksLikeProductBrief(input.message)) {
    return {
      assistantMessage:
        "Send the company URL to continue.",
      phase: "discover",
      productProfile: input.existingProfile,
      recommendedConnectors: [],
      suggestedActions: [],
      suggestedReplies: ["We don't have a website yet"],
    };
  }

  const discovery = await discoverFeedbackSourcesFromProduct({
    orgId: input.orgId,
    productBrief: input.message,
  });
  return {
    assistantMessage:
      "Review the company details, then confirm or change them.",
    phase: "discover",
    productProfile: {
      ...input.existingProfile,
      ...discovery.productProfile,
      companyLogo: input.existingProfile.companyLogo ?? null,
      companyProfileConfirmed: false,
      companyProfileReadyForConfirmation: true,
    },
    recommendedConnectors: [],
    suggestedActions: [],
    suggestedReplies: [],
  };
}

export async function confirmCompanyProfileTurn(input: {
  orgId: string;
  state: OnboardingState;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
}): Promise<OnboardingTurnResult> {
  const profile = input.state.productProfile;
  if (!profile.productName?.trim()) {
    throw new Error("Company details are incomplete");
  }
  const brief = [
    profile.productName,
    profile.productDescription,
    profile.productUrl,
  ].filter(Boolean).join(". ");
  const turn = await productDiscoveryTurn({
    orgId: input.orgId,
    productBrief: brief,
    existingProfile: profile,
    workspaceStatus: input.workspaceStatus,
  });
  return {
    ...turn,
    assistantMessage: `${profile.productName} is confirmed.`,
    productProfile: {
      ...turn.productProfile,
      productName: profile.productName,
      productUrl: profile.productUrl,
      productDescription: profile.productDescription,
      companyLogo: profile.companyLogo ?? null,
      companyProfileConfirmed: true,
      companyProfileReadyForConfirmation: true,
    },
  };
}

function buildSuggestedActions(
  connectors: RecommendedConnector[],
  connectedIntegrationIds: ReadonlySet<string>,
  aiConfigured: boolean,
): OnboardingAction[] {
  const actions: OnboardingAction[] = [];
  for (const connector of connectors) {
    if (
      !isIntegrationAvailable(connector.integrationId) ||
      connectedIntegrationIds.has(connector.integrationId)
    ) {
      continue;
    }
    if (
      connector.connectionMethod === "webhook" &&
      !actions.some((action) => action.type === "connect_webhook")
    ) {
      actions.push({
        type: "connect_webhook",
        label: "Create webhook endpoint",
      });
    }
    if (
      connector.integrationId === "int_github" &&
      !actions.some((action) => action.type === "connect_github")
    ) {
      actions.push({ type: "connect_github", label: "Connect GitHub" });
    } else if (connector.connectionMethod === "oauth") {
      actions.push({
        type: "oauth_connect",
        integrationId: connector.integrationId,
        label: `Connect ${connector.provider}`,
      });
    }
  }
  if (
    !aiConfigured &&
    !actions.some((action) => action.type === "open_settings_ai")
  ) {
    actions.push({
      type: "open_settings_ai",
      label: "Enable AI agents",
    });
  }
  return actions.slice(0, 5);
}

export function onboardingGuidanceForWorkspace(input: {
  state: OnboardingState;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
}): {
  recommendedConnectors: RecommendedConnector[];
  suggestedActions: OnboardingAction[];
  suggestedReplies: string[];
} {
  if (!input.state.productProfile.companyProfileConfirmed) {
    return {
      recommendedConnectors: [],
      suggestedActions: [],
      suggestedReplies: input.state.productProfile.companyProfileReadyForConfirmation
        || input.state.productProfile.productUrl
        ? []
        : initialSuggestedReplies(),
    };
  }
  let recommendedConnectors = availableRecommendations(
    input.state.recommendedConnectors,
  ).slice(0, 6);
  if (!recommendedConnectors.some((connector) => connector.integrationId === "int_github")) {
    const github = recommendedConnector(
      "int_github",
      "Select the repositories CloseSpan may inspect, test, and use for approved pull requests.",
    );
    if (github) recommendedConnectors = [github, ...recommendedConnectors].slice(0, 6);
  }
  if (
    !input.workspaceStatus.feedbackConnected &&
    !recommendedConnectors.some((connector) =>
      isFeedbackSourceIntegration(connector.integrationId),
    )
  ) {
    const webhook = recommendedConnector(
      "int_webhook",
      "Custom webhook is the available fallback for first-party feedback intake.",
    );
    if (webhook) {
      recommendedConnectors = [webhook, ...recommendedConnectors].slice(0, 6);
    }
  }
  if (input.state.phase === "complete") {
    return {
      recommendedConnectors,
      suggestedActions: [],
      suggestedReplies: [],
    };
  }

  const connected = connectedIds(input.workspaceStatus);
  const suggestedActions = buildSuggestedActions(
    recommendedConnectors,
    connected,
    input.workspaceStatus.aiConfigured,
  );
  const userTurns = input.state.messages.filter(
    (message) => message.role === "user",
  ).length;
  if (userTurns === 0) {
    return {
      recommendedConnectors,
      suggestedActions,
      suggestedReplies: initialSuggestedReplies(),
    };
  }
  const nextConnector =
    (!input.workspaceStatus.githubConnected
      ? recommendedConnectors.find(
          (connector) =>
            connector.integrationId === "int_github" &&
            !connected.has(connector.integrationId),
        )
      : undefined) ??
    (!input.workspaceStatus.feedbackConnected
      ? recommendedConnectors.find(
          (connector) =>
            isFeedbackSourceIntegration(connector.integrationId) &&
            !connected.has(connector.integrationId),
        )
      : undefined) ??
    recommendedConnectors.find(
      (connector) => !connected.has(connector.integrationId),
    );
  const canContinue =
    input.workspaceStatus.githubConnected &&
    input.workspaceStatus.feedbackConnected;
  return {
    recommendedConnectors,
    suggestedActions,
    suggestedReplies: prioritizeOnboardingContinuation(
      nextConnector ? [`Connect ${nextConnector.provider}`] : [],
      canContinue,
    ),
  };
}

export function initialAssistantMessage(firstName: string): string {
  void firstName;
  return "Hey, How's it going!";
}

export function initialSuggestedReplies(): string[] {
  return ["We don't have a website yet"];
}

const ONBOARDING_SCOPE_REDIRECT =
  "I can help connect feedback sources, manage GitHub setup, or explain this onboarding flow. What would you like to connect?";

function isOnboardingRelatedMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (extractCompanyUrl(message)) return true;
  if (/\b(?:don't|do not|no)\b.{0,24}\b(?:website|site|url)\b/i.test(message)) {
    return true;
  }
  if (
    connectorCatalogForAgent.some(
      (connector) =>
        normalized.includes(connector.provider.toLowerCase()) ||
        normalized.includes(connector.id.replace(/^int_/, "").replaceAll("_", " ")),
    )
  ) {
    return true;
  }
  if (
    /\b(connect|connected|connection|disconnect|integration|connector|source|feedback|import|sync|webhook|github|repository|repo|pull request|\bpr\b|oauth|authorization|approve|setup|onboarding|recommend|recommended|choose|picked|continue|skip|next|retry|failed|failure|error|stuck)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  if (
    /\b(product|company|business|customer|customers|user|users|audience|b2b|b2c|saas|software|platform|service|website|mobile|ios|android|enterprise|startup|support|review|reviews|analytics|developer|developers|engineering|app|application)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  return /^(?:help|what can you do|what does this do|explain this|why these|show connected (?:apps|sources))\??$/i.test(
    normalized,
  );
}

function offTopicOnboardingTurn(input: {
  state: OnboardingState;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
}): OnboardingTurnResult {
  const recommendedConnectors = availableRecommendations(
    input.state.recommendedConnectors,
  );
  return {
    assistantMessage: ONBOARDING_SCOPE_REDIRECT,
    phase: input.state.phase,
    productProfile: input.state.productProfile,
    recommendedConnectors,
    suggestedActions: buildSuggestedActions(
      recommendedConnectors,
      connectedIds(input.workspaceStatus),
      input.workspaceStatus.aiConfigured,
    ),
    suggestedReplies: input.state.productProfile.companyProfileConfirmed
      ? [
          "Connect a recommended source",
          "Show connected sources",
          "Continue onboarding",
        ]
      : ["Send company website", "We don't have a website yet"],
  };
}

function looksLikeProductBrief(message: string): boolean {
  const lower = message.toLowerCase();
  const mentionsToolOnly =
    /^(zendesk|slack|intercom|github|jira|linear)\b/.test(lower) &&
    message.split(/\s+/).length < 6;
  return !mentionsToolOnly && message.trim().length >= 8;
}

export async function runOnboardingTurn(input: {
  orgId: string;
  firstName: string;
  organizationName: string;
  state: OnboardingState;
  userMessage: string;
  workspaceStatus: OnboardingWorkspaceConnectionStatus;
}): Promise<OnboardingTurnResult> {
  const trimmed = input.userMessage.trim();
  if (!trimmed) {
    return {
      assistantMessage:
        "Send the company URL to continue.",
      phase: "discover",
      productProfile: input.state.productProfile,
      recommendedConnectors: availableRecommendations(
        input.state.recommendedConnectors,
      ),
      suggestedActions: [],
      suggestedReplies: initialSuggestedReplies(),
    };
  }

  if (!isOnboardingRelatedMessage(trimmed)) {
    return offTopicOnboardingTurn({
      state: input.state,
      workspaceStatus: input.workspaceStatus,
    });
  }

  if (!input.state.productProfile.companyProfileConfirmed) {
    return companyProfileCandidateTurn({
      orgId: input.orgId,
      message: trimmed,
      existingProfile: input.state.productProfile,
    });
  }

  const failure = reportedConnectorFailure(trimmed);
  if (!input.workspaceStatus.githubConnected) {
    const github = recommendedConnector(
      "int_github",
      "Choose repositories for testing and approved PRs.",
    );
    const recommendedConnectors = github
      ? [
          github,
          ...availableRecommendations(input.state.recommendedConnectors).filter(
            (connector) => connector.integrationId !== "int_github",
          ),
        ].slice(0, 6)
      : availableRecommendations(input.state.recommendedConnectors);
    return {
      assistantMessage:
        failure?.integrationId === "int_github"
          ? "GitHub connection failed. Try again."
          : "Connect GitHub first so you can choose the repositories CloseSpan may test and use for approved PRs.",
      phase: "connect",
      productProfile: input.state.productProfile,
      recommendedConnectors,
      suggestedActions: buildSuggestedActions(
        recommendedConnectors,
        connectedIds(input.workspaceStatus),
        input.workspaceStatus.aiConfigured,
      ),
      suggestedReplies: ["Connect GitHub"],
    };
  }
  if (failure) {
    return connectorFailureTurn({
      state: input.state,
      workspaceStatus: input.workspaceStatus,
      failure,
    });
  }

  // Product-first: first usable brief triggers automatic source discovery.
  if (!hasProductBrief(input.state.productProfile) && looksLikeProductBrief(trimmed)) {
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: trimmed,
      existingProfile: input.state.productProfile,
      workspaceStatus: input.workspaceStatus,
    });
  }

  // Clarifying follow-ups still enrich the product profile, then rediscover.
  if (
    input.state.phase === "discover" ||
    (!input.state.recommendedConnectors.length && looksLikeProductBrief(trimmed))
  ) {
    const combined = [
      input.state.productProfile.productName,
      input.state.productProfile.productDescription,
      trimmed,
    ]
      .filter(Boolean)
      .join(". ");
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: combined,
      existingProfile: input.state.productProfile,
      workspaceStatus: input.workspaceStatus,
    });
  }

  const configuration = await getAiRuntimeConfiguration(input.orgId);
  if (!configuration.apiKey) {
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: trimmed,
      existingProfile: input.state.productProfile,
      workspaceStatus: input.workspaceStatus,
    });
  }

  try {
    const catalog = connectorCatalogForAgent;
    const systemPrompt = buildSystemPrompt(catalog);
    const payload = conversationPayload(
      input.firstName,
      input.organizationName,
      input.state,
      trimmed,
      input.workspaceStatus,
    );

    const parsed =
      configuration.provider === "anthropic"
        ? await callAnthropicOnboarding(configuration, systemPrompt, payload)
        : await callOpenAiCompatible(configuration, systemPrompt, payload);

    const modelRecommendations = availableRecommendations(
      enrichConnectors(parsed.recommendedConnectors),
    );
    let recommendedConnectors =
      modelRecommendations.length > 0
        ? modelRecommendations
        : availableRecommendations(input.state.recommendedConnectors);
    if (
      !recommendedConnectors.some((connector) =>
        isFeedbackSourceIntegration(connector.integrationId),
      ) &&
      !input.workspaceStatus.feedbackConnected
    ) {
      const webhook = recommendedConnector(
        "int_webhook",
        "Custom webhook is the available fallback for first-party feedback intake.",
      );
      if (webhook) recommendedConnectors = [webhook, ...recommendedConnectors];
    }
    recommendedConnectors = recommendedConnectors.slice(0, 6);
    const connected = connectedIds(input.workspaceStatus);
    const modelActions = mapActions(
      parsed.suggestedActions,
      connected,
      input.workspaceStatus.aiConfigured,
    );
    const suggestedActions =
      modelActions.length > 0
        ? modelActions
        : buildSuggestedActions(
            recommendedConnectors,
            connected,
            input.workspaceStatus.aiConfigured,
          );

    return {
      assistantMessage: parsed.assistantMessage,
      phase: parsed.phase === "discover" ? "discover" : "connect",
      productProfile: {
        ...input.state.productProfile,
        ...parsed.productProfile,
      },
      recommendedConnectors,
      suggestedActions,
      suggestedReplies:
        (parsed.suggestedReplies ?? []).length > 0
          ? parsed.suggestedReplies
          : [
              "Connect the recommended sources",
              "Start with a webhook only",
              "Tell me why you picked these",
            ],
    };
  } catch (error) {
    console.error("[onboarding-agent] Falling back after model error", error);
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: trimmed,
      existingProfile: input.state.productProfile,
      workspaceStatus: input.workspaceStatus,
    });
  }
}

export function appendMessage(
  messages: OnboardingMessage[],
  role: OnboardingMessage["role"],
  content: string,
): OnboardingMessage[] {
  return [
    ...messages,
    { role, content, at: new Date().toISOString() },
  ];
}

export function bootstrapOnboardingState(
  firstName: string,
  existing?: OnboardingState,
): OnboardingState {
  const base = existing ?? defaultOnboardingState();
  if (base.messages.length > 0) return base;
  return {
    ...base,
    messages: appendMessage([], "assistant", initialAssistantMessage(firstName)),
  };
}

export async function initializeOnboardingState(input: {
  orgId: string;
  firstName: string;
  existing?: OnboardingState;
  discoverCompany?: typeof discoverCompanyProfile;
}): Promise<OnboardingState> {
  const base = input.existing ?? defaultOnboardingState();
  if (base.messages.length > 0) return base;

  const savedUrl = base.productProfile.productUrl?.trim();
  if (!base.productProfile.companyProfileConfirmed && savedUrl) {
    const turn = await companyProfileCandidateTurn(
      {
        orgId: input.orgId,
        message: savedUrl,
        existingProfile: base.productProfile,
      },
      input.discoverCompany ?? discoverCompanyProfile,
    );
    const discoveredCompany = Boolean(
      turn.productProfile.companyProfileReadyForConfirmation &&
        turn.productProfile.productName?.trim(),
    );
    return {
      phase: turn.phase,
      productProfile: turn.productProfile,
      recommendedConnectors: turn.recommendedConnectors,
      messages: discoveredCompany
        ? appendMessage([], "assistant", initialAssistantMessage(input.firstName))
        : appendMessage(
            appendMessage([], "assistant", initialAssistantMessage(input.firstName)),
            "assistant",
            turn.assistantMessage,
          ),
    };
  }

  return bootstrapOnboardingState(input.firstName, base);
}
