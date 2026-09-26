import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringTicketSpecification } from "./engineering-prompt";
import type { ReviewRow } from "./problem-prompt-review-repository";

const mock = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mock.query }),
  transaction: async (run: (client: { query: typeof mock.query }) => unknown) => run({ query: mock.query }),
}));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mock.mode }));
import {
  acceptProblemPromptReviewByPolicy, automaticPromptReviewAcceptanceIsCurrent,
  claimProblemPromptReview, finishProblemPromptReview, readAutomaticPromptReviewActivation, reviewFromRow,
  retryProblemPromptReview,
} from "./problem-prompt-review-repository";
import { automaticPromptAcceptanceSql } from "./automatic-prompt-acceptance";

const ticket: EngineeringTicketSpecification = {
  userStory: "As an analyst, I want exports to contain all selected rows so I can finish reporting.",
  currentBehavior: "The export contains no rows.", expectedBehavior: "The export contains every selected row.",
  reproductionSteps: ["Export a dataset with 10,001 rows."], businessOutcome: "Analysts can finish reporting.",
  acceptanceCriteria: [{ id: "AC-1", statement: "The export contains all 10,001 rows.", measurable: true }],
  testScenarios: [{ id: "TEST-1", title: "Complete export", given: "A dataset with 10,001 rows", when: "The user exports CSV", then: "All selected rows are present", testLevel: "integration", criterionIds: ["AC-1"] }],
  regressionScenarios: ["Small exports continue to work."], negativeScenarios: ["Storage failures remain visible."],
  qualityExpectations: ["Do not log customer data."], requiredTestLevels: ["integration"],
  releaseVerification: "Export a production-safe synthetic 10,001-row dataset after deployment.",
  nonGoals: ["Changing export formats."], permittedPaths: ["src/export/**", "tests/export/**"],
  requiredCommands: ["npm test -- export"], repository: "acme/product", baseBranch: "main", baseSha: "b".repeat(40),
};
const row: ReviewRow = { org_id: "org", problem_id: "problem", status: "Testing", version: 2,
  prompt_hash: "a".repeat(64), user_story: ticket.userStory, feedback: "", evaluation: null,
  attempts: 0, failure_message: null, confirmed_at: null, updated_at: new Date(), lease_id: "lease" };
const input = { promptHash: row.prompt_hash!, userStory: row.user_story,
  evaluation: { verdict: "Passed" as const, changes: [], summary: "The prompt covers the expected behavior." }, attempts: 1 };
const activation = { id: "activation", occurred_at: new Date("2026-09-01T00:00:00Z") };
const settings = { autonomy_level: "Automatic coding, human merge", monthly_model_budget: 100, used_model_cost: 1, hard_stop: true };
const prompt = { content_hash: row.prompt_hash, status: "Ready", created_at: new Date("2026-09-02T00:00:00Z"),
  structured_snapshot: { schemaVersion: 1, ticket, evidence: { missingInformation: [] as string[] } } };
const rows = (value: unknown[]) => ({ rows: value, rowCount: value.length });

function sequence(overrides: { settings?: unknown[]; activation?: unknown[]; review?: unknown[]; prompt?: unknown[] } = {}) {
  mock.query.mockResolvedValueOnce(rows(overrides.settings ?? [settings]))
    .mockResolvedValueOnce(rows(overrides.activation ?? [activation]))
    .mockResolvedValueOnce(rows(overrides.review ?? [row]))
    .mockResolvedValueOnce(rows(overrides.prompt ?? [prompt]));
}
beforeEach(() => { vi.resetAllMocks(); mock.mode.mockReturnValue("postgres"); mock.query.mockResolvedValue(rows([])); });

describe("automatic requirement acceptance", () => {
  it("records a separate receipt atomically without a human confirmation", async () => {
    sequence();
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(true);
    const [auditSql, auditParams] = mock.query.mock.calls[4];
    const receipt = JSON.parse(auditParams[2]);
    expect(auditSql).toContain("($3::jsonb)::text");
    expect(auditSql).toContain("'ProblemPromptPolicyAcceptance'");
    expect(auditSql).toContain("'agent_prompt_review'");
    expect(receipt).toMatchObject({ kind: "automatic_prompt_acceptance", policy: settings.autonomy_level,
      activationId: activation.id, promptHash: row.prompt_hash, userStory: row.user_story, reviewVersion: 3, leaseId: row.lease_id });
    const [updateSql, updateParams] = mock.query.mock.calls[5];
    expect(updateSql).toContain("status='Preparing tests'");
    expect(updateSql).toContain("confirmed_by=NULL,confirmed_at=NULL");
    expect(JSON.parse(updateParams[4]).policyAcceptance).toEqual(receipt);
    expect(mock.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(mock.query.mock.calls[2][0]).toContain("lease_id=$3 AND version=$4 AND leased_at > now()-interval '15 minutes' FOR UPDATE");
  });
  it.each(["Observe", "Recommend", "Execute with approval", "Full autonomy"])("does not policy-accept in %s", async (level) => {
    sequence({ settings: [{ ...settings, autonomy_level: level }] });
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(false);
    expect(mock.query).toHaveBeenCalledTimes(1);
  });
  it.each([{ hard_stop: false }, { monthly_model_budget: 0 }, { used_model_cost: 100 }, { used_model_cost: NaN }])("fails closed for invalid budget %j", async (budget) => {
    sequence({ settings: [{ ...settings, ...budget }] });
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(false);
    expect(mock.query).toHaveBeenCalledTimes(1);
  });
  it("requires a recorded activation", async () => {
    sequence({ activation: [] });
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(false);
    expect(mock.query).toHaveBeenCalledTimes(2);
    expect(mock.query.mock.calls[1][0]).toContain("ORDER BY occurred_at DESC,id DESC");
  });
  it("does not accept an expired, replaced, or already-consumed lease", async () => {
    sequence({ review: [] });
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(false);
    expect(mock.query.mock.calls[2][1]).toEqual(["org", "problem", "lease", 2]);
    expect(mock.query).toHaveBeenCalledTimes(3);
  });
  it.each([{ content_hash: "c".repeat(64) }, { status: "Approved" }, { created_at: new Date("2026-08-01T00:00:00Z") }, { created_at: new Date(NaN) }])("rejects stale or historically pending prompts %j", async (change) => {
    sequence({ prompt: [{ ...prompt, ...change }] });
    expect(await acceptProblemPromptReviewByPolicy(row, input)).toBe(false);
    expect(mock.query).toHaveBeenCalledTimes(4);
  });
  it.each([
    { ticket, evidence: { missingInformation: ["Expected export behavior is unclear"] } },
    { ticket, evidence: {} },
    { ticket: { ...ticket, expectedBehavior: "" }, evidence: { missingInformation: [] } },
  ])("keeps missing or ambiguous requirements for human attention", async (snapshot) => {
    sequence({ prompt: [{ ...prompt, structured_snapshot: snapshot }] });
    await expect(acceptProblemPromptReviewByPolicy(row, input)).rejects.toThrow("missing or ambiguous information");
    expect(mock.query).toHaveBeenCalledTimes(4);
  });
  it.each([
    { evaluation: { ...input.evaluation, verdict: "Needs revision" as const } },
    { evaluation: { ...input.evaluation, changes: ["Clarify expected behavior"] } },
    { attempts: 0 }, { attempts: 4 }, { userStory: "" },
  ])("rejects incomplete checks and exhausted retry bounds before writing", async (change) => {
    expect(await acceptProblemPromptReviewByPolicy(row, { ...input, ...change })).toBe(false);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("keeps policy acceptance out of the human confirmation projection", () => {
    const result = reviewFromRow({ ...row, evaluation: { ...input.evaluation, policyAcceptance: {
      kind: "automatic_prompt_acceptance", policy: "Automatic coding, human merge", receiptId: "receipt",
      activationId: "activation", promptHash: row.prompt_hash!, userStory: row.user_story, reviewVersion: 3, leaseId: "lease",
    } } });
    expect(result.confirmedAt).toBeNull(); expect(result.result).toEqual(input.evaluation);
    expect(result.result).not.toHaveProperty("policyAcceptance");
  });
});

describe("policy receipt lifecycle boundaries", () => {
  it("requires matching prompt, story, tenant, actor, canonical audit, current mode and latest activation", () => {
    const sql = automaticPromptAcceptanceSql("review", "prompt.content_hash");
    expect(sql).toMatch(/^COALESCE\(/);
    expect(sql).toContain("review.prompt_hash=prompt.content_hash");
    expect(sql).toContain("->>'userStory'=review.user_story");
    expect(sql).toContain("policy_receipt.org_id=review.org_id");
    expect(sql).toContain("policy_receipt.entity_id=review.problem_id");
    expect(sql).toContain("policy_receipt.actor_id='agent_prompt_review'");
    expect(sql).toContain("policy_receipt.action=(review.evaluation->'policyAcceptance')::text");
    expect(sql).toContain("policy_settings.autonomy_level='Automatic coding, human merge'");
    expect(sql).toContain("ORDER BY activation.occurred_at DESC,activation.id DESC LIMIT 1");
    expect(sql).toContain("review.status IN ('Preparing tests','Awaiting approval')");
    expect(sql).toContain("review.evaluation->'changes'='[]'::jsonb");
  });
  it("rechecks the lease version and latest prompt on automatic continuation", async () => {
    mock.query.mockResolvedValue(rows([]));
    expect(await automaticPromptReviewAcceptanceIsCurrent(row)).toBe(false);
    expect(mock.query.mock.calls[0][1]).toEqual([row.org_id, row.problem_id, row.lease_id, row.version]);
    expect(mock.query.mock.calls[0][0]).toContain("ORDER BY p.revision DESC LIMIT 1");
    expect(mock.query.mock.calls[0][0]).toContain("review.leased_at > now()-interval '15 minutes'");
  });
  it("claims post-activation ready work while preserving human-confirmed historical work", async () => {
    await claimProblemPromptReview("org", activation.occurred_at);
    const [sql, params] = mock.query.mock.calls[3];
    expect(params).toEqual(["org", activation.occurred_at]);
    expect(sql).toContain("$2::timestamptz IS NOT NULL AND review.status='Ready'");
    expect(sql).toContain("current_prompt.revision DESC LIMIT 1) >= $2::timestamptz");
    expect(sql).toContain("review.confirmed_at IS NOT NULL AND review.status IN ('Confirmed','Preparing tests')");
    expect(mock.query.mock.calls[2][0]).toContain("evaluation=NULL");
  });
  it("clears prior policy acceptance when an administrator retries", async () => {
    mock.query.mockResolvedValue(rows([{ problem_id: "problem" }]));
    await retryProblemPromptReview({ orgId: "org", organizationName: "Acme", actorId: "admin", actorName: "Admin",
      actorEmail: "admin@example.com", role: "Admin", traceId: "retry", idempotencyKey: "retry" }, "problem", 2);
    expect(mock.query.mock.calls[0][0]).toContain("evaluation=NULL");
  });
  it("reads the latest activation from occurred_at and only for the explicit mode", async () => {
    mock.query.mockResolvedValue(rows([activation]));
    expect(await readAutomaticPromptReviewActivation("org")).toEqual(activation);
    expect(mock.query.mock.calls[0][1]).toEqual(["org", "Enabled automatic coding with human merge", "Automatic coding, human merge"]);
  });
  it("rejects updates after lease expiry and does not manufacture an audit", async () => {
    await finishProblemPromptReview(row, { status: "Ready" });
    expect(mock.query).toHaveBeenCalledTimes(1);
    expect(mock.query.mock.calls[0][0]).toContain("leased_at > now()-interval '15 minutes'");
  });
});
