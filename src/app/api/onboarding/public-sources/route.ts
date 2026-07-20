import { NextRequest, NextResponse } from "next/server";
import {
  discoverPublicFeedbackSources,
  publicFeedbackDiscoveryConfiguration,
  publicFeedbackDiscoveryInputSchema,
} from "@/lib/public-feedback-discovery";
import { claimPublicDiscoveryRequest } from "@/lib/public-discovery-cost-guard";
import {
  authorizeMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

const FRIENDLY_DISCOVERY_ERROR =
  "Public feedback discovery is unavailable right now. Please try again later.";

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeMutation(request);
    const parsed = publicFeedbackDiscoveryInputSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return errorResponse(
        new HttpError(400, "Valid product details are required"),
      );
    }

    const configuration = publicFeedbackDiscoveryConfiguration();
    if (configuration.you.enabled && configuration.you.configured) {
      const claim = await claimPublicDiscoveryRequest({
        orgId: context.orgId,
        actorId: context.actorId,
        idempotencyKey: context.idempotencyKey,
      });
      if (claim === "duplicate") {
        return errorResponse(
          new HttpError(409, "This discovery request was already submitted"),
        );
      }
      if (claim === "rate_limited") {
        return errorResponse(
          new HttpError(
            429,
            "Public feedback discovery is busy. Please try again in a minute.",
          ),
        );
      }
    }

    const result = await discoverPublicFeedbackSources(parsed.data);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[public-feedback-discovery] Request failed");
    return errorResponse(new HttpError(503, FRIENDLY_DISCOVERY_ERROR));
  }
}
