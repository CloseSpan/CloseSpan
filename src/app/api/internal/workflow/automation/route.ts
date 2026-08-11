import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runProblemAutomationForAllOrganizations } from "@/lib/problem-automation-repository";
import { runSlackAutomationForAllOrganizations } from "@/lib/slack-intake";
import { deliverBillingShadow } from "@/lib/billing-outbox";
import { noStoreHeaders } from "@/lib/request-security";
import { processQueuedFinalExecutions } from "@/lib/final-execution-repository";
import { dispatchQueuedReleaseVerifications } from "@/lib/release-lifecycle-repository";

export const maxDuration = 300;
const BILLING_DELIVERY_BUDGET_MS = 20_000;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  try {
    const releaseExecutions = await processQueuedFinalExecutions();
    const releaseVerifications = await dispatchQueuedReleaseVerifications();
    const slack = await runSlackAutomationForAllOrganizations();
    const results = await runProblemAutomationForAllOrganizations();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const billing = await Promise.race([
      deliverBillingShadow({
        customerLimit: 2,
        eventLimit: 10,
        maxDurationMs: 15_000,
      }).catch((error: unknown) => {
        console.error("[billing:shadow-delivery]", {
          message: error instanceof Error ? error.message : "Billing delivery failed",
        });
        return { error: "Shadow billing delivery failed" };
      }),
      new Promise<{ deferred: true }>((resolve) => {
        timer = setTimeout(
          () => resolve({ deferred: true }),
          BILLING_DELIVERY_BUDGET_MS,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    return NextResponse.json(
      { billing, releaseExecutions, releaseVerifications, slack, results },
      { headers: noStoreHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Workflow automation failed" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
