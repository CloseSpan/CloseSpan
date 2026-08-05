import { NextRequest, NextResponse } from "next/server";
import {
  confirmDetectedExecutionProfile,
  listExecutionProfileSettings,
} from "@/lib/execution-profile-repository";
import { refreshPendingProblemRepositoryMatches } from "@/lib/problem-repository-match-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = await request.json() as { detectedProfileId?: unknown };
    if (
      typeof body.detectedProfileId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.detectedProfileId)
    ) {
      throw new HttpError(400, "A detected execution profile is required");
    }
    const profile = await confirmDetectedExecutionProfile({
      orgId: context.orgId,
      detectedProfileId: body.detectedProfileId,
      actor: context,
    });
    const repositoryMatches = await refreshPendingProblemRepositoryMatches(context.orgId);
    return NextResponse.json(
      {
        profile,
        repositoryMatches,
        settings: await listExecutionProfileSettings(context.orgId),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
