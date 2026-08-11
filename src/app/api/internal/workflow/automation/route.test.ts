import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runAll } = vi.hoisted(() => ({
  runAll: vi.fn(async () => []),
}));

const { runSlack } = vi.hoisted(() => ({
  runSlack: vi.fn(async () => []),
}));

const { deliverBilling } = vi.hoisted(() => ({
  deliverBilling: vi.fn(async () => ({
    enabled: false,
    configured: false,
    customersProvisioned: 0,
    eventsAccepted: 0,
    retried: 0,
    failed: 0,
  })),
}));

const { processExecutions, dispatchVerifications } = vi.hoisted(() => ({
  processExecutions: vi.fn(async () => []),
  dispatchVerifications: vi.fn(async () => ({ dispatched: 0, skipped: true })),
}));

vi.mock("@/lib/problem-automation-repository", () => ({
  runProblemAutomationForAllOrganizations: runAll,
}));

vi.mock("@/lib/slack-intake", () => ({
  runSlackAutomationForAllOrganizations: runSlack,
}));

vi.mock("@/lib/billing-outbox", () => ({
  deliverBillingShadow: deliverBilling,
}));

vi.mock("@/lib/final-execution-repository", () => ({
  processQueuedFinalExecutions: processExecutions,
}));

vi.mock("@/lib/release-lifecycle-repository", () => ({
  dispatchQueuedReleaseVerifications: dispatchVerifications,
}));

import { GET } from "./route";

describe("workflow automation cron boundary", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    runAll.mockClear();
    runSlack.mockClear();
    deliverBilling.mockClear();
    processExecutions.mockClear();
    dispatchVerifications.mockClear();
  });

  it("rejects a missing cron secret", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/internal/workflow/automation"),
    );
    expect(response.status).toBe(401);
    expect(runAll).not.toHaveBeenCalled();
    expect(deliverBilling).not.toHaveBeenCalled();
  });

  it("runs one coordinator tick per workspace for Vercel cron", async () => {
    process.env.CRON_SECRET = "workflow-cron-secret-for-tests";
    const response = await GET(
      new NextRequest("http://localhost/api/internal/workflow/automation", {
        headers: {
          authorization: "Bearer workflow-cron-secret-for-tests",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(runSlack).toHaveBeenCalledOnce();
    expect(runAll).toHaveBeenCalledOnce();
    expect(deliverBilling).toHaveBeenCalledOnce();
    expect(processExecutions).toHaveBeenCalledOnce();
    expect(dispatchVerifications).toHaveBeenCalledOnce();
  });

  it("does not block workflow automation when shadow delivery fails", async () => {
    process.env.CRON_SECRET = "workflow-cron-secret-for-tests";
    deliverBilling.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await GET(
      new NextRequest("http://localhost/api/internal/workflow/automation", {
        headers: {
          authorization: "Bearer workflow-cron-secret-for-tests",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      billing: { error: "Shadow billing delivery failed" },
    });
    expect(runSlack).toHaveBeenCalledOnce();
    expect(runAll).toHaveBeenCalledOnce();
  });

  it("finishes core automation before a hanging billing provider is deferred", async () => {
    vi.useFakeTimers();
    try {
      process.env.CRON_SECRET = "workflow-cron-secret-for-tests";
      deliverBilling.mockImplementationOnce(
        () => new Promise<never>(() => undefined),
      );
      const responsePromise = GET(
        new NextRequest("http://localhost/api/internal/workflow/automation", {
          headers: {
            authorization: "Bearer workflow-cron-secret-for-tests",
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(runSlack).toHaveBeenCalledOnce();
      expect(runAll).toHaveBeenCalledOnce();
      expect(deliverBilling).toHaveBeenCalledOnce();
      expect(runAll.mock.invocationCallOrder[0]).toBeLessThan(
        deliverBilling.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );

      await vi.advanceTimersByTimeAsync(20_000);
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        billing: { deferred: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
