import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiProviders, getAiPublicConfiguration } from "@/lib/ai-config";
import {
  AiConfigurationPersistenceError,
  removeStoredAiCredential,
  saveAiConfiguration,
} from "@/lib/ai-config-repository";
import { CredentialVaultConfigurationError } from "@/lib/credential-crypto";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const configurationSchema = z
  .object({
    provider: z.enum(aiProviders),
    model: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(
        /^[A-Za-z0-9._:/-]+$/,
        "Model IDs may contain letters, numbers, dots, slashes, colons, underscores, and hyphens",
      ),
    apiKey: z.string().trim().min(12).max(512).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const context = authorizeRead(request);
    return NextResponse.json(await getAiPublicConfiguration(context.orgId), {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = authorizeAdminMutation(request);
    const parsed = configurationSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ??
          "Enter a valid AI provider configuration",
      );
    const result = await saveAiConfiguration({
      ...parsed.data,
      orgId: context.orgId,
      context,
    });
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof CredentialVaultConfigurationError)
      return errorResponse(new HttpError(503, error.message));
    if (error instanceof AiConfigurationPersistenceError)
      return errorResponse(new HttpError(409, error.message));
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = authorizeAdminMutation(request);
    return NextResponse.json(
      await removeStoredAiCredential(context.orgId, context),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof AiConfigurationPersistenceError)
      return errorResponse(new HttpError(409, error.message));
    return errorResponse(error);
  }
}
