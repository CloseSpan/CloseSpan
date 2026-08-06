import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CredentialVaultConfigurationError } from "@/lib/credential-crypto";
import {
  createRuntimeSecret,
  listRuntimeSecretMetadata,
  revokeRuntimeSecretVersion,
  rotateRuntimeSecret,
} from "@/lib/runtime-secret-repository";
import {
  authorizeAdminMutation,
  authorizeAdminRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const MAX_PAYLOAD_BYTES = 64_000;

const createSchema = z.object({
  environmentName: z.string(),
  label: z.string().optional(),
  scopeType: z.enum(["workspace", "repository"]).default("workspace"),
  repository: z.string().optional(),
  workspaceRoot: z.string().optional(),
  value: z.string(),
}).strict();

const rotateSchema = z.object({
  secretId: z.string().uuid(),
  value: z.string(),
  revokePrevious: z.boolean().default(true),
}).strict();

const revokeSchema = z.object({
  secretId: z.string().uuid(),
  version: z.number().int().positive(),
  reason: z.string().optional(),
}).strict();

async function payload(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PAYLOAD_BYTES) {
    throw new HttpError(413, "Runtime secret payload is too large");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new HttpError(413, "Runtime secret payload is too large");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "Runtime secret payload must be valid JSON");
  }
}

function routeError(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return errorResponse(
      new HttpError(
        400,
        error.issues[0]?.message ?? "Runtime secret payload is invalid",
      ),
    );
  }
  if (error instanceof CredentialVaultConfigurationError) {
    return errorResponse(new HttpError(503, error.message));
  }
  return errorResponse(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    return NextResponse.json(
      { secrets: await listRuntimeSecretMetadata(context.orgId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const input = createSchema.parse(await payload(request));
    const secret = await createRuntimeSecret({
      orgId: context.orgId,
      ...input,
      actor: context,
    });
    return NextResponse.json({ secret }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const input = rotateSchema.parse(await payload(request));
    const secret = await rotateRuntimeSecret({
      orgId: context.orgId,
      ...input,
      actor: context,
    });
    return NextResponse.json({ secret }, { headers: noStoreHeaders });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const input = revokeSchema.parse(await payload(request));
    const secret = await revokeRuntimeSecretVersion({
      orgId: context.orgId,
      ...input,
      actor: context,
    });
    return NextResponse.json({ secret }, { headers: noStoreHeaders });
  } catch (error) {
    return routeError(error);
  }
}
