import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAiRuntimeConfiguration } from "@/lib/ai-config";
import {
  completeModelRun,
  failModelRun,
  getFeedbackAnalysisContext,
  reserveModelRun,
} from "@/lib/ai-repository";
import {
  analyzeFeedbackWithProvider,
  AiProviderConfigurationError,
  AiProviderResponseError,
} from "@/lib/ai-provider";
import {
  CredentialDecryptionError,
  CredentialVaultConfigurationError,
} from "@/lib/credential-crypto";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const requestSchema = z
  .object({
    feedbackIds: z.array(z.string().min(1).max(128)).min(1).max(25),
  })
  .strict();

export async function POST(request: NextRequest) {
  let run: { orgId: string; runId: string } | undefined;
  try {
    const context = authorizeMutation(request);
    const configuration = await getAiRuntimeConfiguration(context.orgId);
    if (!configuration.configured || !configuration.apiKey)
      throw new HttpError(
        503,
        `${configuration.providerLabel} is not configured. Add its API key in Settings.`,
      );
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        "Select between 1 and 25 valid feedback records",
      );
    if (
      new Set(parsed.data.feedbackIds).size !== parsed.data.feedbackIds.length
    )
      throw new HttpError(
        400,
        "Each feedback record may be selected only once",
      );

    const analysisContext = await getFeedbackAnalysisContext(
      context.orgId,
      parsed.data.feedbackIds,
    );
    const reservation = await reserveModelRun({
      orgId: context.orgId,
      promptVersionId: analysisContext.prompt.id,
      provider: configuration.provider,
      providerLabel: configuration.providerLabel,
      model: configuration.model,
      idempotencyKey: context.idempotencyKey,
      feedbackIds: parsed.data.feedbackIds,
    });
    if (reservation.kind === "replay")
      return NextResponse.json(reservation.result, { headers: noStoreHeaders });
    if (reservation.kind === "running")
      throw new HttpError(409, "This AI analysis is already running");
    if (reservation.kind === "failed")
      throw new HttpError(
        409,
        `This idempotent AI request already failed: ${reservation.message}`,
      );
    run = { orgId: context.orgId, runId: reservation.runId };

    const result = await analyzeFeedbackWithProvider({
      configuration,
      systemPrompt: analysisContext.prompt.systemPrompt,
      feedback: analysisContext.feedback,
      candidates: analysisContext.candidates,
    });
    return NextResponse.json(
      await completeModelRun({
        orgId: context.orgId,
        runId: reservation.runId,
        result,
        context,
      }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (run) await failModelRun(run.orgId, run.runId, error);
    if (
      error instanceof AiProviderConfigurationError ||
      error instanceof CredentialVaultConfigurationError ||
      error instanceof CredentialDecryptionError
    )
      return errorResponse(new HttpError(503, error.message));
    if (error instanceof AiProviderResponseError)
      return errorResponse(new HttpError(502, error.message));
    if (isProviderApiError(error))
      return errorResponse(
        new HttpError(
          502,
          "The selected AI provider could not complete the analysis. No recommendation was applied.",
        ),
      );
    return errorResponse(error);
  }
}

function isProviderApiError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    [
      "APIError",
      "APIConnectionError",
      "APIConnectionTimeoutError",
      "AuthenticationError",
      "RateLimitError",
      "InternalServerError",
    ].includes(error.name)
  );
}
