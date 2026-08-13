import { describe, expect, it, vi } from "vitest";
import type { ProblemRepositoryMatchView } from "./execution-profile";
import { resolveRuntimeVerificationRepositoryBinding } from "./issue-runtime-verification";
import { ProblemRepositoryMatchError } from "./problem-repository-match-repository";

const actor = {
  actorId: "user-1",
  actorName: "Avery Chen",
  traceId: "trace-1",
};

const match: ProblemRepositoryMatchView = {
  problemId: "problem-1",
  repository: "samshanmukh/zup",
  workspaceRoot: "ZupNative",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileHash: "a".repeat(64),
  confidence: 0.95,
  reasons: ["This is the workspace's only active authorized repository."],
  status: "Confirmed",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("runtime verification repository binding", () => {
  it("reuses an existing active ticket binding", async () => {
    const getActiveMatch = vi.fn().mockResolvedValue(match);
    const refreshMatch = vi.fn();
    const confirmMatch = vi.fn();

    await expect(resolveRuntimeVerificationRepositoryBinding(
      { orgId: "org-1", problemId: "problem-1", actor },
      { getActiveMatch, refreshMatch, confirmMatch },
    )).resolves.toEqual(match);
    expect(refreshMatch).not.toHaveBeenCalled();
    expect(confirmMatch).not.toHaveBeenCalled();
  });

  it("automatically confirms a deterministic active repository and root", async () => {
    const getActiveMatch = vi.fn().mockResolvedValue(null);
    const refreshMatch = vi.fn().mockResolvedValue({
      problemId: "problem-1",
      resolution: {
        selected: {
          repository: match.repository,
          defaultBranch: "main",
          workspaceRoots: [match.workspaceRoot],
          confidence: match.confidence,
          reasons: match.reasons,
        },
        ranked: [],
        needsReview: false,
        reason: "The only authorized repository was selected.",
      },
      persistedProfileId: match.profileId,
      profileDetectionRequired: false,
    });
    const confirmMatch = vi.fn().mockResolvedValue({ match });

    await expect(resolveRuntimeVerificationRepositoryBinding(
      { orgId: "org-1", problemId: "problem-1", actor },
      { getActiveMatch, refreshMatch, confirmMatch },
    )).resolves.toEqual(match);
    expect(confirmMatch).toHaveBeenCalledWith(expect.objectContaining({
      repository: match.repository,
      profileId: match.profileId,
      actor,
    }));
  });

  it("leaves ambiguous repository evidence for human review", async () => {
    const confirmMatch = vi.fn();
    const result = await resolveRuntimeVerificationRepositoryBinding(
      { orgId: "org-1", problemId: "problem-1", actor },
      {
        getActiveMatch: vi.fn().mockResolvedValue(null),
        refreshMatch: vi.fn().mockResolvedValue({
          problemId: "problem-1",
          resolution: {
            selected: null,
            ranked: [],
            needsReview: true,
            reason: "The leading repository match is too close to the next candidate.",
          },
          persistedProfileId: null,
          profileDetectionRequired: false,
        }),
        confirmMatch,
      },
    );

    expect(result).toBeNull();
    expect(confirmMatch).not.toHaveBeenCalled();
  });

  it("does not bind a deterministic suggestion whose profile is inactive", async () => {
    const result = await resolveRuntimeVerificationRepositoryBinding(
      { orgId: "org-1", problemId: "problem-1", actor },
      {
        getActiveMatch: vi.fn().mockResolvedValue(null),
        refreshMatch: vi.fn().mockResolvedValue({
          problemId: "problem-1",
          resolution: {
            selected: {
              repository: match.repository,
              defaultBranch: "main",
              confidence: 0.95,
              reasons: match.reasons,
            },
            ranked: [],
            needsReview: false,
            reason: "The only authorized repository was selected.",
          },
          persistedProfileId: match.profileId,
          profileDetectionRequired: false,
        }),
        confirmMatch: vi.fn().mockRejectedValue(
          new ProblemRepositoryMatchError("The selected profile is not active", 409),
        ),
      },
    );

    expect(result).toBeNull();
  });
});
