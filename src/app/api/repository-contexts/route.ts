import { after, NextRequest, NextResponse } from "next/server";
import {
  buildQueuedRepositoryContexts,
  listRepositoryContexts,
  queueMissingAuthorizedRepositoryContexts,
  queueRepositoryContextRetry,
  repositoryContextProviderConfigured,
} from "@/lib/repository-context-repository";
import {
  authorizeAdminMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    return NextResponse.json(
      {
        provider: "CloseSpan Repository Context",
        providerConfigured: repositoryContextProviderConfigured(),
        contexts: await listRepositoryContexts(context.orgId),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const body = (await request.json().catch(() => null)) as {
      repository?: unknown;
    } | null;
    if (body && body.repository === undefined) {
      const repositories = await queueMissingAuthorizedRepositoryContexts(context.orgId);
      if (repositories.length) {
        after(() => buildQueuedRepositoryContexts(context.orgId, repositories));
      }
      return NextResponse.json(
        { queued: repositories.length > 0, repositories },
        { status: 202, headers: noStoreHeaders },
      );
    }
    if (!body || typeof body.repository !== "string" || !body.repository.trim()) {
      throw new HttpError(400, "A repository is required");
    }
    const repository = body.repository.trim();
    await queueRepositoryContextRetry(context.orgId, repository);
    after(() => buildQueuedRepositoryContexts(context.orgId, [repository]));
    return NextResponse.json(
      { queued: true, repository },
      { status: 202, headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
