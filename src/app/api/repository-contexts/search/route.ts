import { NextRequest, NextResponse } from "next/server";
import { searchRepositoryContext } from "@/lib/repository-context-repository";
import {
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

async function search(
  request: NextRequest,
  repository: unknown,
  query: unknown,
) {
  const context = await authorizeRead(request);
  if (
    typeof repository !== "string" ||
    typeof query !== "string" ||
    !repository.trim() ||
    query.trim().length < 3 ||
    query.length > 8_000
  ) {
    throw new HttpError(400, "A repository and search question are required");
  }
  const result = await searchRepositoryContext({
    orgId: context.orgId,
    repository: repository.trim(),
    query: query.trim(),
  });
  return NextResponse.json(result, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      repository?: unknown;
      query?: unknown;
    } | null;
    return await search(request, body?.repository, body?.query);
  } catch (error) {
    return errorResponse(error);
  }
}
