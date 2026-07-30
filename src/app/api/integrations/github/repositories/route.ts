import { NextRequest, NextResponse } from "next/server";
import { listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { authorizeRead, errorResponse, HttpError, noStoreHeaders } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json({ repositories: await listGithubRepositoryAuthorizations(context.orgId) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    await authorizeRead(request);
    throw new HttpError(
      405,
      "Repository access is synchronized from the CloseSpan GitHub App. Change repository access in GitHub and return to CloseSpan.",
    );
  } catch (error) { return errorResponse(error); }
}
