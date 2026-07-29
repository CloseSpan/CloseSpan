import { NextRequest, NextResponse } from "next/server";
import {
  getEngineeringWorkflow,
  saveEngineeringSpecification,
} from "@/lib/engineering-workflow-repository";
import {
  authorizeMutation,
  authorizeRead,
  errorResponse,
  noStoreHeaders,
} from "@/lib/request-security";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const [context, { problemId }] = await Promise.all([
      authorizeRead(request),
      params,
    ]);
    return NextResponse.json(
      { workflow: await getEngineeringWorkflow(context.orgId, problemId) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const context = await authorizeMutation(request);
    const { problemId } = await params;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 128_000)
      return NextResponse.json(
        { error: "Engineering ticket payload is too large" },
        { status: 413, headers: noStoreHeaders },
      );
    const specification: unknown = await request.json();
    return NextResponse.json(
      {
        workflow: await saveEngineeringSpecification(
          context.orgId,
          problemId,
          specification,
          context,
        ),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
