import { NextRequest, NextResponse } from "next/server";
import { displayFirstName } from "@/lib/auth-user";
import {
  appendMessage,
  bootstrapOnboardingState,
  initialSuggestedReplies,
  runOnboardingTurn,
} from "@/lib/onboarding-agent";
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
    const state = bootstrapOnboardingState(
      firstName,
      await getOnboardingState(context.orgId),
    );
    if (state.messages.length === 1 && state.messages[0]?.role === "assistant") {
      await saveOnboardingState(context.orgId, state);
    }
    const userTurns = state.messages.filter((message) => message.role === "user").length;
    return NextResponse.json(
      {
        ...state,
        suggestedReplies: userTurns === 0 ? initialSuggestedReplies() : [],
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
    const existing = bootstrapOnboardingState(
      firstName,
      await getOnboardingState(context.orgId),
    );
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
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
