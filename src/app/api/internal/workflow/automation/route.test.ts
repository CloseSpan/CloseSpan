import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runAll } = vi.hoisted(() => ({
  runAll: vi.fn(async () => []),
}));

const { runSlack } = vi.hoisted(() => ({
  runSlack: vi.fn(async () => []),
}));

vi.mock("@/lib/problem-automation-repository", () => ({
  runProblemAutomationForAllOrganizations: runAll,
}));

vi.mock("@/lib/slack-intake", () => ({
  runSlackAutomationForAllOrganizations: runSlack,
}));

import { GET } from "./route";

describe("workflow automation cron boundary", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    runAll.mockClear();
    runSlack.mockClear();
  });

  it("rejects a missing cron secret", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/internal/workflow/automation"),
    );
    expect(response.status).toBe(401);
    expect(runAll).not.toHaveBeenCalled();
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
  });
});
