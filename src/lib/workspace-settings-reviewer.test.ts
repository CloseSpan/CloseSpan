import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPromptDraftPolicy } from "./prompt-draft-policy";
import { readPromptDraftPolicy, updateWorkspacePolicy } from "./workspace-settings-repository";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({
  databasePool: () => ({ query: mocks.query }),
  transaction: (work: (client: { query: typeof mocks.query }) => Promise<unknown>) => work({ query: mocks.query }),
}));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));

const row = {
  prompt_draft_mode: "automatic", prompt_draft_bug_reports: true, prompt_draft_feature_requests: true,
  prompt_draft_min_evidence: 3, prompt_draft_min_confidence: 0.75,
  prompt_draft_notify_in_app: true, prompt_draft_notify_email: false, prompt_draft_reviewer_id: null,
};
const policy = {
  autonomyLevel: "Execute with approval", piiRedaction: true, retentionDays: 365,
  priorityWeights: { frequency: 100 }, promptDraftPolicy: defaultPromptDraftPolicy,
  promptEvaluationMode: "pdd_cloud",
};
const actor = { actorId: "admin", actorName: "Sam", traceId: "test" };

describe("workspace reviewer default", () => {
  beforeEach(() => { mocks.query.mockReset(); mocks.mode.mockReturnValue("postgres"); });

  it("uses the tenant's admin for existing unassigned policies", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ id: "admin" }] });
    expect(await readPromptDraftPolicy("org-one")).toMatchObject({ reviewerId: "admin", minimumEvidence: 1, minimumConfidence: 0.75 });
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining("org_id=$1 AND role='Admin' ORDER BY id LIMIT 1"), ["org-one"]);
  });

  it("preserves assigned reviewers without performing a fallback lookup", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ ...row, prompt_draft_reviewer_id: "member" }] });
    expect((await readPromptDraftPolicy("org-one")).reviewerId).toBe("member");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("does not assign a member when the workspace has no admin", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    expect((await readPromptDraftPolicy("org-one")).reviewerId).toBeNull();
  });

  it("defaults new policies before any settings exist", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "admin" }] });
    expect(await readPromptDraftPolicy("org-new")).toMatchObject({ reviewerId: "admin", minimumEvidence: 1, minimumConfidence: 0.65 });
  });

  it("persists the admin default and allows replacing it", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "admin" }] });
    expect((await updateWorkspacePolicy("org-one", policy, actor)).promptDraftPolicy.reviewerId).toBe("admin");
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE workspace_settings"));
    expect(update?.[1][12]).toBe("admin");
    expect(update?.[1][8]).toBe(1);
    mocks.query.mockClear();
    expect((await updateWorkspacePolicy("org-one", { ...policy, promptDraftPolicy: { ...defaultPromptDraftPolicy, reviewerId: "member" } }, actor)).promptDraftPolicy.reviewerId).toBe("member");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("role='Admin'"))).toBe(false);
  });

  it("uses the demo admin in memory mode", async () => {
    mocks.mode.mockReturnValue("memory");
    expect((await readPromptDraftPolicy("org-demo-reviewer")).reviewerId).toBe("user_avery");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["Automatic coding, human merge", "Full autonomy"])("records an explicit activation boundary when opting into %s", async (autonomyLevel) => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.query.mockResolvedValueOnce({ rows: [{ autonomy_level: "Execute with approval" }] });
    await updateWorkspacePolicy("org-one", { ...policy, autonomyLevel, promptDraftPolicy: { ...defaultPromptDraftPolicy, reviewerId: "member" } }, actor);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("Enabled automatic coding with human merge"), expect.arrayContaining(["org-one", "admin"]));
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE approval_requests"))).toBe(false);
  });

  it("preserves the activation boundary when saving the same automatic policy again", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.query.mockResolvedValueOnce({ rows: [{ autonomy_level: "Automatic coding, human merge" }] });
    await updateWorkspacePolicy("org-one", { ...policy, autonomyLevel: "Automatic coding, human merge", promptDraftPolicy: { ...defaultPromptDraftPolicy, reviewerId: "member" } }, actor);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("Enabled automatic coding with human merge"))).toBe(false);
  });
});
