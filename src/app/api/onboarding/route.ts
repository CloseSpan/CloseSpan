import { NextRequest, NextResponse } from "next/server";
import { displayFirstName } from "@/lib/auth-user";
import {
  appendMessage,
  bootstrapOnboardingState,
  confirmCompanyProfileTurn,
  initializeOnboardingState,
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
import { renameOrganization } from "@/lib/organization-repository";
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
      "Company details are incomplete",
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
    const state = await initializeOnboardingState({
      orgId: context.orgId,
      firstName,
      existing: storedState,
    });
    if (storedState.messages.length === 0 && state.messages.length > 0) {
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
        organizationName: context.organizationName,
        userEmail: context.actorEmail,
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
        organizationName: context.organizationName,
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
    const action = typeof body?.action === "string" ? body.action : "";
    if (!["continue", "confirm_company", "restart_company"].includes(action)) {
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

    if (action === "restart_company") {
      const restarted = {
        ...existing,
        phase: "discover" as const,
        productProfile: {
          productName: null,
          productUrl: null,
          productDescription: null,
          companyLogo: null,
          companyProfileConfirmed: false,
          companyProfileReadyForConfirmation: false,
          feedbackSources: [],
          engineeringTools: [],
        },
        recommendedConnectors: [],
        messages: appendMessage(
          existing.messages,
          "assistant",
          "Send the correct company website URL and I'll fetch the details again.",
        ),
      };
      await saveOnboardingState(context.orgId, restarted);
      return NextResponse.json(
        {
          ...restarted,
          suggestedActions: [],
          suggestedReplies: [],
          workspaceStatus: workspaceConnectionStatus(setup),
          organizationName: context.organizationName,
        },
        { headers: noStoreHeaders },
      );
    }

    if (action === "confirm_company") {
      if (context.role !== "Admin") {
        throw new HttpError(403, "Administrator permission is required");
      }
      if (!existing.productProfile.productName?.trim()) {
        throw new HttpError(400, "Company details are incomplete");
      }
      const turn = await confirmCompanyProfileTurn({
        orgId: context.orgId,
        state: existing,
        workspaceStatus: workspaceConnectionStatus(setup),
      });
      const messagesWithConfirmation = appendMessage(
        existing.messages,
        "user",
        `Confirmed ${existing.productProfile.productName.trim()}`,
      );
      const confirmed = {
        phase: turn.phase,
        productProfile: turn.productProfile,
        recommendedConnectors: turn.recommendedConnectors,
        messages: appendMessage(
          messagesWithConfirmation,
          "assistant",
          turn.assistantMessage,
        ),
      };
      await renameOrganization({
        orgId: context.orgId,
        name: turn.productProfile.productName!,
        actor: {
          actorId: context.actorId,
          actorName: context.actorName,
          traceId: context.traceId,
        },
      });
      await saveOnboardingState(context.orgId, confirmed);
      return NextResponse.json(
        {
          ...confirmed,
          suggestedActions: turn.suggestedActions,
          suggestedReplies: turn.suggestedReplies,
          workspaceStatus: workspaceConnectionStatus(setup),
          organizationName: turn.productProfile.productName,
        },
        { headers: noStoreHeaders },
      );
    }

    const completed = { ...existing, phase: "complete" as const };
    await saveOnboardingState(context.orgId, completed);
    const workspaceStatus = workspaceConnectionStatus(setup);
    return NextResponse.json(
      {
        ...completed,
        suggestedActions: [],
        suggestedReplies: [],
        workspaceStatus,
        organizationName: context.organizationName,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
