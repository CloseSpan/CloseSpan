import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
const profiles = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("./db", () => ({ databasePool: () => database }));
vi.mock("./workspace-persistence", () => ({ requirePostgresWorkspace: vi.fn() }));
vi.mock("./execution-profile-repository", () => ({
  saveProblemRepositoryMatch: profiles.save,
}));

import { refreshProblemRepositoryMatch } from "./problem-repository-match-repository";

const problem = {
  id: "problem-1",
  title: "Billing invoice export fails",
  statement: "Invoices cannot be exported from billing.",
  summary: "Revenue teams need reliable billing exports.",
  product_area: "Billing",
  team: "Revenue systems",
  suspected_repository: "Not yet identified",
  suspected_files: ["services/billing/src/invoice.ts"],
};

describe("durable problem repository matching", () => {
  beforeEach(() => {
    database.query.mockReset();
    profiles.save.mockReset().mockResolvedValue(undefined);
  });

  it("persists a high-confidence suggestion against an immutable profile", async () => {
    database.query
      .mockResolvedValueOnce({ rows: [problem] })
      .mockResolvedValueOnce({
        rows: [
          {
            repository: "acme/mobile",
            default_branch: "main",
            profile_id: "11111111-1111-4111-8111-111111111111",
            workspace_root: ".",
            profile_active: true,
            config: { language: "typescript" },
            detection_evidence: {},
          },
          {
            repository: "acme/billing",
            default_branch: "main",
            profile_id: "22222222-2222-4222-8222-222222222222",
            workspace_root: "services/billing",
            profile_active: false,
            config: { language: "typescript", framework: "Next.js" },
            detection_evidence: { manifestPaths: ["services/billing/package.json"] },
          },
        ],
      });

    const result = await refreshProblemRepositoryMatch("org-1", "problem-1");
    expect(result.resolution.selected?.repository).toBe("acme/billing");
    expect(result.persistedProfileId).toBe("22222222-2222-4222-8222-222222222222");
    expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId: "problem-1",
      profileId: "22222222-2222-4222-8222-222222222222",
      status: "Suggested",
    }));
  });

  it("reports that profile detection is required without inventing a binding", async () => {
    database.query
      .mockResolvedValueOnce({ rows: [problem] })
      .mockResolvedValueOnce({
        rows: [{
          repository: "acme/platform",
          default_branch: "main",
          profile_id: null,
          workspace_root: null,
          profile_active: false,
          config: null,
          detection_evidence: null,
        }],
      });

    const result = await refreshProblemRepositoryMatch("org-1", "problem-1");
    expect(result.resolution.selected?.repository).toBe("acme/platform");
    expect(result.profileDetectionRequired).toBe(true);
    expect(profiles.save).not.toHaveBeenCalled();
  });

  it("refreshes a stale root suggestion to the repository's active root", async () => {
    database.query
      .mockResolvedValueOnce({ rows: [{ ...problem, suspected_files: [] }] })
      .mockResolvedValueOnce({
        rows: [{
          repository: "samshanmukh/zup",
          default_branch: "main",
          profile_id: "11111111-1111-4111-8111-111111111111",
          workspace_root: ".",
          profile_active: false,
          config: { language: "typescript", framework: "Next.js" },
          detection_evidence: {},
        }, {
          repository: "samshanmukh/zup",
          default_branch: "main",
          profile_id: "22222222-2222-4222-8222-222222222222",
          workspace_root: "ZupNative",
          profile_active: true,
          config: { language: "swift", framework: "iOS" },
          detection_evidence: {},
        }],
      });

    const result = await refreshProblemRepositoryMatch("org-1", "problem-1");
    expect(result.persistedProfileId).toBe("22222222-2222-4222-8222-222222222222");
    expect(profiles.save).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "22222222-2222-4222-8222-222222222222",
    }));
  });

  it("does not persist ambiguous multi-repository evidence", async () => {
    database.query
      .mockResolvedValueOnce({
        rows: [{
          ...problem,
          title: "Export fails",
          statement: "An export fails.",
          summary: "Customers cannot export.",
          product_area: "Reporting",
          team: "Platform",
          suspected_files: [],
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { repository: "acme/export-api", default_branch: "main", profile_id: "1", workspace_root: ".", profile_active: true, config: {}, detection_evidence: {} },
          { repository: "acme/export-worker", default_branch: "main", profile_id: "2", workspace_root: ".", profile_active: true, config: {}, detection_evidence: {} },
        ],
      });

    const result = await refreshProblemRepositoryMatch("org-1", "problem-1");
    expect(result.resolution.needsReview).toBe(true);
    expect(result.persistedProfileId).toBeNull();
    expect(profiles.save).not.toHaveBeenCalled();
  });
});
