import { NextRequest, NextResponse } from "next/server";
import { listAuthorizedGithubRepositoryBranches } from "@/lib/github-repository-allowlist";
import {
  authorizeAdminRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeAdminRead(request);
    const repository = request.nextUrl.searchParams.get("repository")?.trim();
    if (!repository) throw new HttpError(400, "Repository is required");

    return NextResponse.json(
      await listAuthorizedGithubRepositoryBranches({
        orgId: context.orgId,
        repository,
      }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
