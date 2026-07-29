import { NextRequest, NextResponse } from "next/server";
import { authorizeGithubRepository, listGithubRepositoryAuthorizations } from "@/lib/github-repository-allowlist";
import { authorizeAdminMutation, authorizeRead, errorResponse, noStoreHeaders } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json({ repositories: await listGithubRepositoryAuthorizations(context.orgId) }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const repositories = await authorizeGithubRepository(context.orgId, await request.json(), context);
    return NextResponse.json({ repositories }, { headers: noStoreHeaders });
  } catch (error) { return errorResponse(error); }
}
