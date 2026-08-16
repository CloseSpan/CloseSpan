import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  transition: vi.fn(),
}));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeMutation: dependencies.authorize };
});
vi.mock("@/lib/problem-stage-transition-repository", () => ({
  transitionProblemStage: dependencies.transition,
}));

import { PUT } from "./route";

const context = {
  orgId: "org-1",
  actorId: "user-1",
  actorName: "Avery Chen",
  actorEmail: "avery@example.com",
  role: "Admin",
  idempotencyKey: "stage-1",
  traceId: "trace-1",
};

function request(stage: unknown) {
  return new NextRequest("https://closespan.com/api/problems/problem-1/stage", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage }),
  });
}

describe("manual problem stage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.authorize.mockResolvedValue(context);
    dependencies.transition.mockResolvedValue({
      problemId: "problem-1",
      fromStage: "In progress",
      toStage: "Release Ready",
      sideEffects: ["Update the lifecycle stage"],
      replayed: false,
    });
  });

  it("records an authorized lifecycle transition", async () => {
    const response = await PUT(request("Release Ready"), {
      params: Promise.resolve({ problemId: "problem-1" }),
    });

    expect(response.status).toBe(200);
    expect(dependencies.transition).toHaveBeenCalledWith(
      "org-1",
      "problem-1",
      "Release Ready",
      context,
    );
    await expect(response.json()).resolves.toMatchObject({
      transition: { fromStage: "In progress", toStage: "Release Ready" },
    });
  });

  it("rejects an unknown lifecycle stage", async () => {
    const response = await PUT(request("Merged somewhere"), {
      params: Promise.resolve({ problemId: "problem-1" }),
    });

    expect(response.status).toBe(400);
    expect(dependencies.transition).not.toHaveBeenCalled();
  });
});
