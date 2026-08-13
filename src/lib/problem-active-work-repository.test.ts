import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  workspacePersistenceMode: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => ({ query: mocks.query }),
}));

vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: mocks.workspacePersistenceMode,
}));

import { readProblemActiveWork } from "./problem-active-work-repository";

describe("problem active work", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.workspacePersistenceMode.mockReset();
  });

  it("returns no durable work for an in-memory workspace", async () => {
    mocks.workspacePersistenceMode.mockReturnValue("memory");

    await expect(readProblemActiveWork("org_demo")).resolves.toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("projects one prioritized active phase per problem", async () => {
    mocks.workspacePersistenceMode.mockReturnValue("postgres");
    mocks.query.mockResolvedValue({
      rows: [
        {
          problem_id: "prob_1",
          status: "Verifying",
          started_at: new Date("2026-08-11T12:00:00.000Z"),
        },
        {
          problem_id: "prob_2",
          status: "Tenki",
          started_at: "2026-08-11T12:03:00.000Z",
        },
      ],
    });

    await expect(readProblemActiveWork("org_1")).resolves.toEqual([
      {
        problemId: "prob_1",
        status: "Verifying",
        startedAt: "2026-08-11T12:00:00.000Z",
      },
      {
        problemId: "prob_2",
        status: "Tenki",
        startedAt: "2026-08-11T12:03:00.000Z",
      },
    ]);

    const [query, values] = mocks.query.mock.calls[0];
    expect(query).toContain("post_release_verification_jobs");
    expect(query).toContain("final_execution_attempts");
    expect(query).toContain("agent_runs");
    expect(query).toContain("pdd_prompt_verifications");
    expect(query).toContain("DISTINCT ON (problem_id)");
    expect(values).toEqual(["org_1"]);
  });
});
