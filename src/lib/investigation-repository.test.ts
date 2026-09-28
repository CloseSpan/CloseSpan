import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
const workspace = vi.hoisted(() => ({ mode: "postgres" }));

vi.mock("./db", () => ({
  databasePool: () => database,
  transaction: (work: (client: typeof database) => unknown) => work(database),
}));
vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => workspace.mode,
}));

import {
  createAutomatedInvestigationForProblem,
  createNextAutomatedInvestigation,
  isCustomerVisibleInvestigationTitle,
  listWorkspaceInvestigations,
  mapInvestigationWorkspaceRow,
  recordInvestigationVerification,
} from "./investigation-repository";
import { RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE } from "./runtime-verifier-errors";

const row = {
  id: "inv-1",
  problem_id: "prob-1",
  problem_title: "Large exports are empty",
  title: "Investigate export finalization",
  status: "Gathering evidence",
  confidence: 0.68,
  signal_confidence: 0.92,
  related_signal_count: 1,
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
  verification_status: "Unverified" as const,
  verification_method: null,
  verification_summary: null,
  verification_actor_name: null,
  verified_at: null,
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
      relatedSignalCount: 1,
      missingInformation: ["A failing worker trace"],
      updatedAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("replaces a stored GitHub Contents 404 with the runtime-verifier recovery step", () => {
    const githubContentsError =
      "Not Found - https://docs.github.com/rest/repos/contents#get-repository-content";
    expect(mapInvestigationWorkspaceRow({
      ...row,
      verification_status: "Verification blocked",
      verification_method: "Automated check",
      verification_summary: githubContentsError,
      runtime_run_id: "run-1",
      runtime_status: "Failed",
      runtime_outcome: "Verification blocked",
      runtime_repository: "acme/app",
      runtime_base_sha: "a".repeat(40),
      runtime_summary: githubContentsError,
      runtime_failure_message: githubContentsError,
      runtime_requested_by_name: "Avery Chen",
      runtime_requested_at: new Date("2026-08-12T00:00:00.000Z"),
      runtime_started_at: null,
      runtime_completed_at: new Date("2026-08-12T00:01:00.000Z"),
      runtime_workflow_run_id: null,
    })).toMatchObject({
      verification: { summary: RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE },
      runtimeVerification: {
        summary: RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE,
        failureMessage: RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE,
      },
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

  it("creates one evidence-bound investigation for an imported bug", async () => {
    database.query.mockImplementation(async (query: string) => {
      if (query.includes("FROM product_problems problem")) {
        return {
          rows: [{
            id: "prob-1",
            title: "Post context input does not work",
            statement: "The input does not accept submitted context.",
            summary: "A customer reports a broken input.",
            confidence: 0.65,
            product_area: "Post context",
            suspected_files: [],
            evidence_count: 1,
            feedback_types: ["Bug"],
            feedback_quotes: ["Post Context input doesn't work"],
          }],
        };
      }
      if (query.includes("INSERT INTO investigations")) {
        return { rows: [{ id: "inv-created" }] };
      }
      return { rows: [] };
    });

    await expect(
      createAutomatedInvestigationForProblem("org-1", "prob-1"),
    ).resolves.toMatchObject({
      created: true,
      problemId: "prob-1",
      confidence: 0.65,
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("approved_analysis.classification IN ('Bug','Incident','Feature request','Usability')"),
      ["org-1", "prob-1"],
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("analysis.review_status='Approved'"),
      ["org-1", "prob-1"],
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO investigations"),
      expect.arrayContaining([
        expect.any(String),
        "org-1",
        "prob-1",
        "Post context investigation",
        expect.stringContaining("root cause is not yet confirmed"),
      ]),
    );
  });

  it("creates decision-focused evidence requirements for a feature request", async () => {
    database.query.mockImplementation(async (query: string) => {
      if (query.includes("FROM product_problems problem")) {
        return {
          rows: [{
            id: "prob-feature",
            title: "Add more actions to the three-dot menu",
            statement: "The three-dot menu should offer actions beyond Edit.",
            summary: "A customer requested a broader menu.",
            confidence: 0.81,
            product_area: "Post menu",
            suspected_files: [],
            evidence_count: 1,
            feedback_types: ["Feature request"],
            feedback_quotes: ["Can we have more options in the menu?"],
          }],
        };
      }
      if (query.includes("INSERT INTO investigations")) {
        return { rows: [{ id: "inv-feature" }] };
      }
      return { rows: [] };
    });

    await createAutomatedInvestigationForProblem("org-1", "prob-feature");

    const insertCall = database.query.mock.calls.find(
      ([query]) => String(query).includes("INSERT INTO investigations"),
    );
    expect(insertCall).toBeDefined();
    const parameters = insertCall?.[1] as unknown[];
    expect(JSON.parse(String(parameters[6]))).toEqual([
      "The three-dot menu should offer actions beyond Edit.",
    ]);
    expect(JSON.parse(String(parameters[7]))).toEqual([
      "Confirm the desired outcome and boundaries for “Add more actions to the three-dot menu”.",
      "Define the acceptance criteria for the requested workflow.",
    ]);
    expect(String(parameters[7])).not.toContain("console error");
    expect(String(parameters[7])).not.toContain("second independent customer report");
  });

  it.each([false, true])("supports usability reports without claiming a confirmed defect (queue: %s)", async (queued) => {
    database.query.mockImplementation(async (query: string) => {
      if (query.includes("FROM product_problems problem")) return { rows: [{
        id: "prob-usability", title: "Voice agent misunderstands caller questions",
        statement: "Callers cannot get a relevant answer.", summary: "A confusing conversation.",
        confidence: 0.8, product_area: "Usability", suspected_files: [], evidence_count: 1,
        feedback_types: ["Usability"], feedback_quotes: ["It did not understand my question."],
      }] };
      if (query.includes("INSERT INTO investigations")) return { rows: [{ id: "inv-usability" }] };
      return { rows: [] };
    });

    const result = queued
      ? await createNextAutomatedInvestigation("org-1")
      : await createAutomatedInvestigationForProblem("org-1", "prob-usability");
    expect(result).toMatchObject({ created: true, problemId: "prob-usability" });
    const [query, params] = database.query.mock.calls.find(([sql]) => String(sql).includes("FROM product_problems problem"))!;
    expect(params).toEqual(["org-1", queued ? null : "prob-usability"]);
    expect(query).toContain("'Usability'");
    expect(query).toContain("analysis.review_status='Approved'");
    expect(query).toContain("run.status='Succeeded'");
    const parameters = database.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO investigations"))![1];
    expect(parameters[4]).toContain("friction in the user experience");
    expect(parameters[4]).toContain("not yet confirmed");
    expect(parameters[4]).not.toContain("product defect");
    expect(parameters[7]).toContain("recording, transcript excerpt, or walkthrough");
    expect(parameters[7]).not.toContain("console error");
    expect(parameters[7]).not.toContain("second independent customer report");
    expect(parameters[9]).toContain("complete the reported task");
  });

  const ineligible = {
    stage: "Needs review", investigation_id: null, linked_report_count: 1,
    analyzed_report_count: 1, pending_review_count: 0,
    approved_report_count: 1, eligible_report_count: 0,
  };

  it.each([
    [{ stage: "Closed" }, "This issue is closed. Reopen it"],
    [{ investigation_id: "inv-existing" }, "An investigation already exists for this issue"],
    [{ linked_report_count: 0, analyzed_report_count: 0, approved_report_count: 0 }, "No customer reports are linked to this issue"],
    [{ analyzed_report_count: 0, approved_report_count: 0 }, "The linked reports have no successful analysis"],
    [{ pending_review_count: 1, approved_report_count: 0 }, "The linked reports are awaiting analysis review"],
    [{ approved_report_count: 0 }, "The linked reports have no approved analysis"],
    [{}, "No linked report has an approved Bug, Incident, Feature request, or Usability classification"],
    [{ eligible_report_count: 1 }, "The issue's evidence changed while eligibility was being checked"],
  ])("explains ineligibility accurately for %j", async (changes, message) => {
    database.query.mockImplementation(async (query: string) => ({
      rows: query.includes("AS linked_report_count") ? [{ ...ineligible, ...changes }] : [],
    }));
    const result = await createAutomatedInvestigationForProblem("org-1", "prob-1");
    expect(result).toMatchObject({ created: false, problemId: "prob-1", reason: expect.stringContaining(message) });
    expect(result.investigationId).toBe("investigation_id" in changes ? changes.investigation_id : null);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("WHERE problem.org_id=$1 AND problem.id=$2"), ["org-1", "prob-1"]);
    const [eligibilityQuery] = database.query.mock.calls.find(([sql]) => String(sql).includes("AS linked_report_count"))!;
    expect(eligibilityQuery).toContain("analysis.review_status='Approved' AND run.status='Succeeded'");
    expect(eligibilityQuery).toContain("membership.org_id=problem.org_id");
    expect(eligibilityQuery).toContain("analysis.org_id=feedback.org_id");
    expect(database.query.mock.calls.some(([sql]) => /INSERT|UPDATE/.test(String(sql)))).toBe(false);
  });

  it("does not reveal an absent or another workspace's issue", async () => {
    database.query.mockResolvedValue({ rows: [] });
    await expect(createAutomatedInvestigationForProblem("org-1", "prob-other"))
      .rejects.toMatchObject({ status: 404, message: "This issue was not found in the current workspace." });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("WHERE problem.org_id=$1 AND problem.id=$2"), ["org-1", "prob-other"]);
  });

  it("describes an empty automation queue without claiming evidence is missing", async () => {
    database.query.mockResolvedValue({ rows: [] });
    const result = await createNextAutomatedInvestigation("org-1");
    expect(result).toMatchObject({ created: false, problemId: null, reason: expect.stringContaining("No issues are ready for investigation") });
    expect(result.reason).toContain("Usability");
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes("AS linked_report_count"))).toBe(false);
  });

  it("records a tenant-scoped current-issue verification with audit evidence", async () => {
    database.query.mockImplementation(async (query: string) => {
      if (query.includes("UPDATE investigations investigation")) {
        return { rows: [{ id: "inv-1" }] };
      }
      return { rows: [] };
    });

    await recordInvestigationVerification({
      orgId: "org-1",
      problemId: "prob-1",
      status: "Confirmed current",
      method: "Product reproduction",
      summary: "Reproduced on the current iOS build after entering post context.",
      actor: { actorId: "user-1", actorName: "Avery Chen", traceId: "trace-1" },
    });

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("verification_status=$3"),
      expect.arrayContaining([
        "org-1",
        "prob-1",
        "Confirmed current",
        "Product reproduction",
      ]),
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_events"),
      expect.arrayContaining([
        "org-1",
        "user-1",
        "Avery Chen",
        expect.stringContaining("Recorded issue verification"),
      ]),
    );
  });

  it("rejects verification without meaningful observed evidence", async () => {
    await expect(recordInvestigationVerification({
      orgId: "org-1",
      problemId: "prob-1",
      status: "Confirmed current",
      method: "Product reproduction",
      summary: "It failed.",
      actor: { actorId: "user-1", actorName: "Avery Chen", traceId: "trace-1" },
    })).rejects.toMatchObject({ status: 400 });
    expect(database.query).not.toHaveBeenCalled();
  });
});
