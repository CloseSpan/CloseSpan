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
  integrationCatalog,
  type IntegrationCatalogEntry,
} from "./integration-catalog";
import type { ProductProfile, RecommendedConnector } from "./onboarding-repository";

/**
 * Feelow product → feedback-source discovery.
 *
 * zero.xyz is a developer-machine CLI for ad-hoc paid tool calls (crypto wallet).
 * It cannot OAuth into Zendesk/Slack/App Store for a multi-tenant SaaS workspace,
 * so Feelow owns discovery + connect. Optional future: use zero only for research
 * enrichment (scrape public product pages), never for customer credentials.
 */

const discoverySchema = z.object({
  productName: z.string().nullable(),
  productUrl: z.string().nullable(),
  productDescription: z.string().nullable(),
  productType: z.enum([
    "b2b_saas",
    "consumer_mobile",
    "consumer_web",
    "marketplace",
    "developer_tool",
    "other",
  ]),
  likelySources: z
    .array(
      z.object({
        integrationId: z.string(),
        reason: z.string().min(1).max(280),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .min(1)
    .max(8),
  summary: z.string().min(1).max(400),
});

export type ProductDiscoveryResult = {
  productProfile: ProductProfile;
  recommendedConnectors: RecommendedConnector[];
  summary: string;
  productType: z.infer<typeof discoverySchema>["productType"];
};

const catalogById = new Map(
  integrationCatalog.map((entry) => [entry.id, entry]),
);

function toRecommended(
  items: z.infer<typeof discoverySchema>["likelySources"],
): RecommendedConnector[] {
  const seen = new Set<string>();
  const connectors: RecommendedConnector[] = [];
  for (const item of items) {
    const catalog = catalogById.get(item.integrationId);
    if (!catalog || seen.has(catalog.id)) continue;
    seen.add(catalog.id);
    connectors.push({
      integrationId: catalog.id,
      provider: catalog.provider,
      reason: item.reason,
      priority:
        item.confidence === "high"
          ? "required"
          : item.confidence === "medium"
            ? "recommended"
            : "optional",
      connectionMethod: catalog.connectionMethod,
    });
  }
  return connectors;
}

function heuristicDiscovery(brief: string): ProductDiscoveryResult {
  const lower = brief.toLowerCase();
  const productName =
    brief
      .split(/[.\n]/)[0]
      ?.replace(/^(we(?:'re| are)|i(?:'m| am)|our product is)\s+/i, "")
      .trim()
      .slice(0, 120) || null;

  const urlMatch = brief.match(/https?:\/\/[^\s]+/i);
  const productUrl = urlMatch?.[0] ?? null;

  let productType: ProductDiscoveryResult["productType"] = "other";
  if (/ios|android|mobile app|app store|play store|apk|iphone/.test(lower)) {
    productType = "consumer_mobile";
  } else if (/marketplace|two-sided|buyers and sellers/.test(lower)) {
    productType = "marketplace";
  } else if (/api|sdk|developer|devtools|cli/.test(lower)) {
    productType = "developer_tool";
  } else if (/saas|b2b|enterprise|dashboard|workspace/.test(lower)) {
    productType = "b2b_saas";
  } else if (/website|web app|consumer/.test(lower)) {
    productType = "consumer_web";
  }

  const picks: Array<{
    entry: IntegrationCatalogEntry;
    reason: string;
    confidence: "high" | "medium" | "low";
  }> = [];

  const push = (
    id: string,
    reason: string,
    confidence: "high" | "medium" | "low",
  ) => {
    const entry = catalogById.get(id);
    if (!entry || picks.some((item) => item.entry.id === id)) return;
    picks.push({ entry, reason, confidence });
  };

  if (productType === "consumer_mobile") {
    push(
      "int_app_store",
      "Mobile products usually collect ratings and reviews in the Apple App Store.",
      "high",
    );
    push(
      "int_play_store",
      "Android distribution typically surfaces feedback through Google Play reviews.",
      "high",
    );
    push(
      "int_slack",
      "Support and CS teams often triage store reviews and user reports in Slack.",
      "medium",
    );
  } else if (productType === "b2b_saas" || productType === "developer_tool") {
    push(
      "int_zendesk",
      "B2B products commonly route customer issues through a help desk like Zendesk.",
      "high",
    );
    push(
      "int_slack",
      "Customer and support signals often land in Slack channels for ops triage.",
      "high",
    );
    push(
      "int_intercom",
      "In-product messaging is a common feedback channel for SaaS workspaces.",
      "medium",
    );
  } else if (productType === "consumer_web" || productType === "marketplace") {
    push(
      "int_intercom",
      "Consumer web products often capture feedback via in-app chat.",
      "high",
    );
    push(
      "int_slack",
      "Internal teams usually consolidate customer reports in Slack.",
      "medium",
    );
    push(
      "int_zendesk",
      "Escalated support tickets are a reliable structured feedback source.",
      "medium",
    );
  } else {
    push(
      "int_webhook",
      "Until we confirm native tools, a custom webhook is the fastest intake path.",
      "high",
    );
    push(
      "int_slack",
      "Most teams already discuss customer issues in Slack.",
      "medium",
    );
  }

  // Always offer webhook as a universal fallback if missing.
  push(
    "int_webhook",
    "Custom webhook covers any product events or first-party feedback pipeline.",
    "low",
  );

  const recommendedConnectors = picks.map((item, index) => ({
    integrationId: item.entry.id,
    provider: item.entry.provider,
    reason: item.reason,
    priority: (index === 0
      ? "required"
      : index < 3
        ? "recommended"
        : "optional") as RecommendedConnector["priority"],
    connectionMethod: item.entry.connectionMethod,
  }));

  return {
    productType,
    productProfile: {
      productName,
      productUrl,
      productDescription: brief.trim().slice(0, 800),
      feedbackSources: recommendedConnectors
        .filter((item) => catalogById.get(item.integrationId)?.feedbackSource)
        .map((item) => item.provider),
      engineeringTools: [],
    },
    recommendedConnectors,
    summary: `From your product brief, the likely feedback intake surface is ${recommendedConnectors
      .slice(0, 3)
      .map((item) => item.provider)
      .join(", ")}.`,
  };
}

async function callDiscoveryModel(
  configuration: AiRuntimeConfiguration,
  brief: string,
) {
  const systemPrompt = [
    "You are Feelow's product intelligence module for an Expert Operations Manager.",
    "Given only a product brief, infer where customer feedback likely lives.",
    "Prefer feedback sources (Zendesk, Slack, Intercom, App Store, Play Store, Sentry, PostHog, webhook).",
    "Do not ask the user which tools they use — infer from product type and description.",
    "Only recommend ids from the allowed catalog.",
    "Allowed catalog:",
    JSON.stringify(connectorCatalogForAgent),
  ].join("\n");

  const userPayload = JSON.stringify({
    productBrief: brief,
    instruction:
      "Identify the product and recommend the most likely feedback connectors with reasons.",
  });

  if (configuration.provider === "anthropic") {
    const client = new Anthropic({
      apiKey: configuration.apiKey!,
      baseURL: configuration.baseUrl,
      timeout: configuration.timeoutMs,
      maxRetries: 2,
    });
    const response = await client.messages.parse({
      model: configuration.model,
      max_tokens: Math.min(configuration.maxOutputTokens, 1500),
      system: systemPrompt,
      messages: [{ role: "user", content: userPayload }],
      output_config: { format: zodOutputFormat(discoverySchema) },
    });
    if (!response.parsed_output) throw new Error("No product discovery result");
    return response.parsed_output;
  }

  const client = new OpenAI({
    apiKey: configuration.apiKey!,
    baseURL: configuration.baseUrl,
    timeout: configuration.timeoutMs,
    maxRetries: 2,
  });
  const response = await client.chat.completions.parse({
    model: configuration.model,
    max_completion_tokens: Math.min(configuration.maxOutputTokens, 1500),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
    response_format: zodResponseFormat(discoverySchema, "product_discovery_v1"),
  });
  const parsed = response.choices[0]?.message.parsed;
  if (!parsed) throw new Error("No product discovery result");
  return parsed;
}

export async function discoverFeedbackSourcesFromProduct(input: {
  orgId: string;
  productBrief: string;
}): Promise<ProductDiscoveryResult> {
  const brief = input.productBrief.trim();
  if (!brief) return heuristicDiscovery("Unknown product");

  const configuration = await getAiRuntimeConfiguration(input.orgId);
  if (!configuration.apiKey) return heuristicDiscovery(brief);

  try {
    const parsed = await callDiscoveryModel(configuration, brief);
    const recommendedConnectors = toRecommended(parsed.likelySources);
    const fallback =
      recommendedConnectors.length > 0
        ? recommendedConnectors
        : heuristicDiscovery(brief).recommendedConnectors;

    return {
      productType: parsed.productType,
      productProfile: {
        productName: parsed.productName,
        productUrl: parsed.productUrl,
        productDescription:
          parsed.productDescription ?? brief.slice(0, 800),
        feedbackSources: fallback
          .filter((item) => catalogById.get(item.integrationId)?.feedbackSource)
          .map((item) => item.provider),
        engineeringTools: [],
      },
      recommendedConnectors: fallback,
      summary: parsed.summary,
    };
  } catch (error) {
    console.error("[product-source-discovery] Falling back", error);
    return heuristicDiscovery(brief);
  }
}
