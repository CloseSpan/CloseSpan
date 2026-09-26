import { NextRequest, NextResponse } from "next/server";
import {
  linkReusableGithubInstallation,
  listReusableGithubInstallations,
} from "@/lib/github-reusable-installations";
import {
  authorizeAdminMutation,
  authorizeAdminRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

function reusableConnectionError(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error);
  console.error("GitHub connection reuse failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return errorResponse(new HttpError(503, "GitHub connections could not be loaded. Try again"));
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const installations = await listReusableGithubInstallations(context);
    return NextResponse.json({ installations }, { headers: noStoreHeaders });
  } catch (error) {
    return reusableConnectionError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json().catch(() => null) as { installationId?: unknown } | null;
    if (!body || typeof body.installationId !== "string") {
      throw new HttpError(400, "A GitHub installation is required");
    }
    const result = await linkReusableGithubInstallation(context, body.installationId);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return reusableConnectionError(error);
  }
}
