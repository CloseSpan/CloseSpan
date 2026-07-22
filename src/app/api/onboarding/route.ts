import { NextRequest, NextResponse } from "next/server";
import { displayFirstName } from "@/lib/auth-user";
import {
  appendMessage,
  bootstrapOnboardingState,
  onboardingGuidanceForWorkspace,
  runOnboardingTurn,
  type OnboardingWorkspaceConnectionStatus,
} from "@/lib/onboarding-agent";
import {
  getWorkspaceSetupStatus,
  type WorkspaceSetupStatus,
} from "@/lib/integration-repository";
import {
  getOnboardingState,
  saveOnboardingState,
} from "@/lib/onboarding-repository";
import {
  authorizeMutation,
  authorizeRead,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const FRIENDLY_ONBOARDING_ERROR =
  "Something went wrong. Please try again in a moment.";

function workspaceConnectionStatus(
  setup: WorkspaceSetupStatus,
): OnboardingWorkspaceConnectionStatus {
  return {
    connectedIntegrationIds: setup.connectedIntegrationIds,
    feedbackConnected: setup.feedbackConnected,
    githubConnected: setup.githubConnected,
    aiConfigured: setup.aiConfigured,
    setupComplete: setup.setupComplete,
  };
}

function onboardingErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const safeAuthMessages = new Set([
      "Authentication required",
      "Workspace membership is required",
      "Organization scope is invalid",
      "Contributor permission is required",
      "Administrator permission is required",
      "Cross-origin action rejected",
      "Too many requests",
      "A valid idempotency key is required",
      "Message is required",
      "Select a supported onboarding action.",
    ]);
    if (safeAuthMessages.has(error.message)) return errorResponse(error);
  }
  console.error("[onboarding]", error);
  return errorResponse(new HttpError(503, FRIENDLY_ONBOARDING_ERROR));
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorizeRead(request);
    const firstName = displayFirstName(context.actorName);
    const [storedState, setup] = await Promise.all([
      getOnboardingState(context.orgId),
      getWorkspaceSetupStatus(context.orgId),
    ]);
    const state = bootstrapOnboardingState(firstName, storedState);
    if (state.messages.length === 1 && state.messages[0]?.role === "assistant") {
      await saveOnboardingState(context.orgId, state);
    }
    const workspaceStatus = workspaceConnectionStatus(setup);
    const guidance = onboardingGuidanceForWorkspace({
      state,
      workspaceStatus,
    });
    return NextResponse.json(
      {
        ...state,
        recommendedConnectors: guidance.recommendedConnectors,
        suggestedActions: guidance.suggestedActions,
        suggestedReplies: guidance.suggestedReplies,
        workspaceStatus,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) {
      return errorResponse(new HttpError(400, "Message is required"));
    }

    const firstName = displayFirstName(context.actorName);
    const [storedState, setup] = await Promise.all([
      getOnboardingState(context.orgId),
      getWorkspaceSetupStatus(context.orgId),
    ]);
    const existing = bootstrapOnboardingState(firstName, storedState);
    const withUser = {
      ...existing,
      messages: appendMessage(existing.messages, "user", message),
    };
    const turn = await runOnboardingTurn({
      orgId: context.orgId,
      firstName,
      organizationName: context.organizationName,
      state: withUser,
      userMessage: message,
      workspaceStatus: workspaceConnectionStatus(setup),
    });
    const nextState = {
      phase: turn.phase,
      productProfile: turn.productProfile,
      recommendedConnectors: turn.recommendedConnectors,
      messages: appendMessage(
        withUser.messages,
        "assistant",
        turn.assistantMessage,
      ),
    };
    await saveOnboardingState(context.orgId, nextState);
    return NextResponse.json(
      {
        ...nextState,
        suggestedActions: turn.suggestedActions,
        suggestedReplies: turn.suggestedReplies,
        workspaceStatus: workspaceConnectionStatus(setup),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    if (body?.action !== "continue") {
      return errorResponse(
        new HttpError(400, "Select a supported onboarding action."),
      );
    }

    const firstName = displayFirstName(context.actorName);
    const [storedState, setup] = await Promise.all([
      getOnboardingState(context.orgId),
      getWorkspaceSetupStatus(context.orgId),
    ]);
    const existing = bootstrapOnboardingState(firstName, storedState);
    const completed = { ...existing, phase: "complete" as const };
    await saveOnboardingState(context.orgId, completed);
    const workspaceStatus = workspaceConnectionStatus(setup);
    return NextResponse.json(
      {
        ...completed,
        suggestedActions: [],
        suggestedReplies: [],
        workspaceStatus,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
