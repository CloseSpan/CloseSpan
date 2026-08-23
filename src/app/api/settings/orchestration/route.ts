import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CredentialVaultConfigurationError } from "@/lib/credential-crypto";
import {
  N8nConfigurationError,
  N8nConnectionError,
} from "@/lib/n8n-client";
import {
  getOrchestrationProviderPublicConfiguration,
  orchestrationProviders,
  OrchestrationProviderPersistenceError,
  saveOrchestrationProviderConfiguration,
} from "@/lib/orchestration-provider-repository";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";

const schema = z.object({
  activeProvider: z.enum(orchestrationProviders),
  baseUrl: z.string().trim().max(2048).optional(),
  triggerUrl: z.string().trim().max(2048).optional(),
  apiKey: z.string().trim().min(12).max(2048).optional(),
  signingSecret: z.string().trim().min(16).max(2048).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(
      await getOrchestrationProviderPublicConfiguration(context.orgId),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message
          ?? "Enter a valid orchestration provider configuration.",
      );
    }
    return NextResponse.json(
      await saveOrchestrationProviderConfiguration({
        ...parsed.data,
        orgId: context.orgId,
        context,
      }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof N8nConfigurationError) {
      return errorResponse(new HttpError(400, error.message));
    }
    if (error instanceof N8nConnectionError) {
      return errorResponse(new HttpError(422, error.message));
    }
    if (error instanceof CredentialVaultConfigurationError) {
      return errorResponse(new HttpError(503, error.message));
    }
    if (error instanceof OrchestrationProviderPersistenceError) {
      return errorResponse(new HttpError(409, error.message));
    }
    return errorResponse(error);
  }
}
