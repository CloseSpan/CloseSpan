import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentAiHealthConfiguration } from "@/lib/ai-config";
import { getPipedreamClient, pipedreamConfigured } from "@/lib/pipedream";
import { probePddRunner } from "@/lib/pdd-runner-client";
import { validStatusProbe } from "@/lib/status-probe-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function integrationCanary(): Promise<boolean> {
  if (!pipedreamConfigured()) return false;
  await getPipedreamClient().apps.retrieve("slack", { timeoutInSeconds: 4, maxRetries: 0 });
  return true;
}

async function aiCanary(): Promise<boolean> {
  const config = getEnvironmentAiHealthConfiguration();
  if (!config) return false;
  const base = config.baseUrl.replace(/\/$/, "");
  const url = config.provider === "anthropic" ? `${base}/v1/models?limit=1` : `${base}/models/${encodeURIComponent(config.model)}`;
  const headers = new Headers({ accept: "application/json" });
  if (config.provider === "anthropic") {
    headers.set("x-api-key", config.apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${config.apiKey}`);
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(4_000), cache: "no-store" });
  if (response.body) await response.body.cancel();
  return response.ok;
}

async function componentCanary(component: string): Promise<boolean> {
  if (component === "integrations") return integrationCanary();
  if (component === "ai") return aiCanary();
  if (component === "pdd") return probePddRunner();
  return false;
}

export async function GET(request: NextRequest) {
  if (!await validStatusProbe(request))
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: responseHeaders });
  const component = request.nextUrl.searchParams.get("component");
  if (component !== "integrations" && component !== "ai" && component !== "pdd")
    return NextResponse.json({ error: "Unknown component" }, { status: 400, headers: responseHeaders });
  const checkedAt = new Date().toISOString();
  try {
    const healthy = await componentCanary(component);
    return NextResponse.json({ status: healthy ? "ok" : "degraded", component, checkedAt }, {
      status: healthy ? 200 : 503,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[component-health]", { component, errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ status: "degraded", component, checkedAt }, { status: 503, headers: responseHeaders });
  }
}
