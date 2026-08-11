import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
const workspace = vi.hoisted(() => ({ mode: "postgres" }));

vi.mock("./db", () => ({ databasePool: () => database }));
vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => workspace.mode,
}));

import {
  isCustomerVisibleInvestigationTitle,
  listWorkspaceInvestigations,
  mapInvestigationWorkspaceRow,
} from "./investigation-repository";

const row = {
  id: "inv-1",
  problem_id: "prob-1",
  problem_title: "Large exports are empty",
  title: "Investigate export finalization",
  status: "Gathering evidence",
  confidence: 0.68,
  signal_confidence: 0.92,
  severity: "High" as const,
  stage: "Needs review" as const,
  product_area: "Exports",
  team: "Data Experience",
  repository: "acme/app",
  hypothesis: "Completion is emitted before storage finalizes.",
  assumptions: ["The reports share one pipeline."],
  missing_information: ["A failing worker trace"],
  proposed_action: "Trace finalization order.",
  recommended_tests: ["Reproduce at the row boundary"],
  suspected_files: ["src/export.ts"],
  updated_at: new Date("2026-08-09T00:00:00.000Z"),
};

describe("investigation workspace repository", () => {
  beforeEach(() => {
    workspace.mode = "postgres";
    database.query.mockReset();
  });

  it("maps a complete selectable engineering investigation", () => {
    expect(mapInvestigationWorkspaceRow(row)).toMatchObject({
      id: "inv-1",
      problemId: "prob-1",
      problemTitle: "Large exports are empty",
      signalConfidence: 0.92,
      missingInformation: ["A failing worker trace"],
      updatedAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("hides internal production canaries from the customer queue", async () => {
    database.query.mockResolvedValue({
      rows: [
        row,
        { ...row, id: "inv-canary", title: "Production agent execution canary" },
      ],
    });

    await expect(listWorkspaceInvestigations("org-1")).resolves.toEqual([
      expect.objectContaining({ id: "inv-1" }),
    ]);
    expect(isCustomerVisibleInvestigationTitle("Profile dashboard filter recomputation"))
      .toBe(true);
    expect(isCustomerVisibleInvestigationTitle("Strict production catalog canary"))
      .toBe(false);
  });

  it("keeps every query tenant scoped", async () => {
    database.query.mockResolvedValue({ rows: [] });
    await listWorkspaceInvestigations("org-1");
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE investigation.org_id=$1"),
      ["org-1"],
    );
  });
});
