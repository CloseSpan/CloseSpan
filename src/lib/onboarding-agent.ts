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
  connectorCatalogForAgent,
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
      if (!catalog) return null;
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
): OnboardingAction[] {
  const actions: OnboardingAction[] = [];
  for (const item of raw) {
    switch (item.action) {
      case "connect_webhook":
        actions.push({ type: "connect_webhook", label: item.label });
        break;
      case "connect_github":
        actions.push({ type: "connect_github", label: item.label });
        break;
      case "open_settings_ai":
        actions.push({ type: "open_settings_ai", label: item.label });
        break;
      case "oauth_connect":
        if (item.integrationId?.trim()) {
          actions.push({
            type: "oauth_connect",
            integrationId: item.integrationId,
            label: item.label,
          });
        }
        break;
    }
  }
  return actions;
}

function buildSystemPrompt(catalog: readonly ConnectorCatalogEntry[]): string {
  return [
    "You are Feelow's Expert Operations Manager — an autonomous ops lead inside the product.",
    "Phase rules:",
    "1) First, collect ONLY product details (name, URL if any, what it does, who uses it). Do not ask which tools they use.",
    "2) Once you have a usable product brief, set phase to connect and recommend feedback connectors inferred from the product (Zendesk, Slack, Intercom, App Store, Play Store, webhook, etc.).",
    "Never ask the user to list Zendesk/Slack/etc. — infer sources from the product itself.",
    "Speak like a senior ops manager: decisive, calm, practical.",
    "Ask one focused question only while still gathering product details. Keep assistantMessage under 90 words.",
    "Always return 2-4 short suggestedReplies.",
    "Never invent connectors outside the catalog. Prefer webhook as universal fallback.",
    "Allowed connectors JSON:",
    JSON.stringify(catalog),
  ].join("\n");
}

function hasProductBrief(profile: ProductProfile): boolean {
  return Boolean(
    profile.productName?.trim() ||
      profile.productDescription?.trim() ||
      profile.productUrl?.trim(),
  );
}

function conversationPayload(
  firstName: string,
  organizationName: string,
  state: OnboardingState,
  userMessage: string,
) {
  return JSON.stringify({
    workspace: organizationName,
    userFirstName: firstName,
    currentPhase: state.phase,
    existingProfile: state.productProfile,
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
}): Promise<OnboardingTurnResult> {
  const discovery = await discoverFeedbackSourcesFromProduct({
    orgId: input.orgId,
    productBrief: input.productBrief,
  });
  const productProfile: ProductProfile = {
    ...input.existingProfile,
    ...discovery.productProfile,
  };
  const recommendedConnectors = discovery.recommendedConnectors.slice(0, 6);
  return {
    assistantMessage: `${discovery.summary} Connect the sources below and I'll start intake into the Feedback inbox.`,
    phase: "connect",
    productProfile,
    recommendedConnectors,
    suggestedActions: buildSuggestedActions(recommendedConnectors),
    suggestedReplies: [
      "Connect the recommended sources",
      "Start with a webhook only",
      "Tell me why you picked these",
    ],
  };
}

function buildSuggestedActions(
  connectors: RecommendedConnector[],
): OnboardingAction[] {
  const actions: OnboardingAction[] = [];
  for (const connector of connectors) {
    if (connector.connectionMethod === "webhook" && !actions.some((a) => a.type === "connect_webhook")) {
      actions.push({
        type: "connect_webhook",
        label: "Create webhook endpoint",
      });
    }
    if (connector.integrationId === "int_github" && !actions.some((a) => a.type === "connect_github")) {
      actions.push({ type: "connect_github", label: "Connect GitHub" });
    }
    if (connector.connectionMethod === "oauth") {
      actions.push({
        type: "oauth_connect",
        integrationId: connector.integrationId,
        label: `Connect ${connector.provider}`,
      });
    }
  }
  if (!actions.some((action) => action.type === "open_settings_ai")) {
    actions.push({
      type: "open_settings_ai",
      label: "Enable AI agents",
    });
  }
  return actions.slice(0, 5);
}

export function initialAssistantMessage(firstName: string): string {
  return `Hi ${firstName}. I'm your Feelow Operations Manager. Start with the product only — name, what it does, and a URL if you have one. I'll identify where feedback likely lives and connect those sources.`;
}

export function initialSuggestedReplies(): string[] {
  return [
    "B2B analytics SaaS for enterprise teams",
    "Consumer iOS + Android fitness app",
    "Developer API platform at https://example.com",
    "Marketplace connecting buyers and sellers",
  ];
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
}): Promise<OnboardingTurnResult> {
  const trimmed = input.userMessage.trim();
  if (!trimmed) {
    return {
      assistantMessage:
        "Tell me about the product itself — what you're shipping and who it's for. I'll handle finding the feedback apps.",
      phase: "discover",
      productProfile: input.state.productProfile,
      recommendedConnectors: input.state.recommendedConnectors,
      suggestedActions: [],
      suggestedReplies: initialSuggestedReplies(),
    };
  }

  // Product-first: first usable brief triggers automatic source discovery.
  if (!hasProductBrief(input.state.productProfile) && looksLikeProductBrief(trimmed)) {
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: trimmed,
      existingProfile: input.state.productProfile,
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
    });
  }

  const configuration = await getAiRuntimeConfiguration(input.orgId);
  if (!configuration.apiKey) {
    return productDiscoveryTurn({
      orgId: input.orgId,
      productBrief: trimmed,
      existingProfile: input.state.productProfile,
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
    );

    const parsed =
      configuration.provider === "anthropic"
        ? await callAnthropicOnboarding(configuration, systemPrompt, payload)
        : await callOpenAiCompatible(configuration, systemPrompt, payload);

    const recommendedConnectors =
      enrichConnectors(parsed.recommendedConnectors).length > 0
        ? enrichConnectors(parsed.recommendedConnectors)
        : input.state.recommendedConnectors;
    const suggestedActions =
      mapActions(parsed.suggestedActions).length > 0
        ? mapActions(parsed.suggestedActions)
        : buildSuggestedActions(recommendedConnectors);

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
