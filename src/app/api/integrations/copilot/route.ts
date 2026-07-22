import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import { getWorkspaceSetupStatus } from "@/lib/integration-repository";
import { runIntegrationCopilot } from "@/lib/integration-copilot";
import { getOnboardingState } from "@/lib/onboarding-repository";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(600),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(800),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new HttpError(400, "Send a short integration question.");

    const [setup, onboarding, configuration] = await Promise.all([
      getWorkspaceSetupStatus(context.orgId),
      getOnboardingState(context.orgId),
      getAiRuntimeConfiguration(context.orgId),
    ]);
    const result = await runIntegrationCopilot({
      message: parsed.data.message,
      history: parsed.data.history,
      connectedIntegrationIds: setup.connectedIntegrationIds,
      productProfile: onboarding.productProfile,
      configuration,
    });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[integration-copilot] Guidance unavailable", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      new HttpError(
        503,
        "The integration guide is temporarily unavailable. You can still use the connector catalog below.",
      ),
    );
  }
}
