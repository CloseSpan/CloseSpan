import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminMutation, errorResponse, noStoreHeaders } from "@/lib/request-security";
import { updateWorkspacePolicy } from "@/lib/workspace-settings-repository";
import { createNextAutomatedPromptDraft } from "@/lib/automated-prompt-draft-repository";
import { deliverPromptReviewEmails } from "@/lib/prompt-review-email";

export async function PUT(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 64_000)
      return NextResponse.json({ error: "Workspace policy payload is too large" }, { status: 413, headers: noStoreHeaders });
    const policy = await updateWorkspacePolicy(context.orgId, await request.json(), context);
    const promptDraft = policy.promptDraftPolicy.mode === "automatic"
      ? await createNextAutomatedPromptDraft(context.orgId)
      : undefined;
    const emailDelivery = policy.promptDraftPolicy.emailNotifications
      ? await deliverPromptReviewEmails(context.orgId)
      : undefined;
    return NextResponse.json({ policy, promptDraft, emailDelivery }, { headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
