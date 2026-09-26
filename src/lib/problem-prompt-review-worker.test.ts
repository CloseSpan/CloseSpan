import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  policy: vi.fn(), persistence: vi.fn(), claim: vi.fn(), finish: vi.fn(), workflow: vi.fn(),
  generate: vi.fn(), context: vi.fn(), evaluate: vi.fn(), revise: vi.fn(), acceptance: vi.fn(),
  configured: vi.fn(), dispatch: vi.fn(), execution: vi.fn(), mark: vi.fn(), fail: vi.fn(),
  lease: vi.fn(), budget: vi.fn(), activation: vi.fn(), accept: vi.fn(), receipt: vi.fn(),
}));
vi.mock("./workspace-settings-repository", () => ({ readAutonomyLevel: mock.policy, automaticCodingBudgetAvailable: mock.budget }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mock.persistence }));
vi.mock("./problem-prompt-review-repository", () => ({
  claimProblemPromptReview: mock.claim, finishProblemPromptReview: mock.finish, reviewLeaseIsCurrent: mock.lease,
  readAutomaticPromptReviewActivation: mock.activation, acceptProblemPromptReviewByPolicy: mock.accept,
  automaticPromptReviewAcceptanceIsCurrent: mock.receipt,
}));
vi.mock("./engineering-workflow-repository", () => ({
  getEngineeringWorkflow: mock.workflow, generateImplementationPrompt: mock.generate, getPromptAlignmentContext: mock.context,
  generatePddAcceptanceContract: mock.acceptance, getPddVerificationExecutionContext: mock.execution,
  markPddVerificationGenerating: mock.mark, failPddVerification: mock.fail,
}));
vi.mock("./closespan-prompt-agent", () => ({ testPromptWithCloseSpanAgent: mock.evaluate, applyPromptRevisionWithCloseSpanAgent: mock.revise }));
vi.mock("./pdd-runner-client", () => ({ pddRunnerConfigured: mock.configured, dispatchPddVerification: mock.dispatch }));
vi.mock("./investigation-repository", () => ({ createAutomatedInvestigationForProblem: vi.fn() }));
vi.mock("./automated-prompt-draft-repository", () => ({ createAutomatedPromptDraftForProblem: vi.fn(), readPromptDraftReadiness: vi.fn() }));
vi.mock("./problem-repository-match-repository", () => ({ refreshProblemRepositoryMatch: vi.fn() }));
vi.mock("./issue-runtime-verification", () => ({}));
vi.mock("./issue-runtime-verification-executor", () => ({}));
import { runProblemPromptReviewTick } from "./problem-prompt-review-worker";

const job = { org_id: "org", problem_id: "problem", lease_id: "lease", version: 1, confirmed_at: null, status: "Testing", attempts: 0, prompt_hash: "a".repeat(64), user_story: "The menu offers additional actions." };
const workflow = { prompt: { id: "prompt", status: "Ready", contentHash: job.prompt_hash }, specification: { userStory: job.user_story }, readiness: { ready: true, issues: [] } };
const activation = { id: "activation", occurred_at: new Date("2026-09-01T00:00:00Z") };
beforeEach(() => {
  vi.resetAllMocks(); mock.policy.mockResolvedValue("Execute with approval"); mock.persistence.mockReturnValue("postgres");
  mock.claim.mockResolvedValue(job); mock.workflow.mockResolvedValue(workflow);
  mock.context.mockResolvedValue({ promptHash: job.prompt_hash, implementationPrompt: "Prompt" });
  mock.evaluate.mockResolvedValue({ verdict: "Passed", changes: [], promptHash: job.prompt_hash }); mock.configured.mockReturnValue(true);
  mock.lease.mockResolvedValue(true);
  mock.activation.mockResolvedValue(activation); mock.budget.mockResolvedValue(true);
  mock.accept.mockResolvedValue(true); mock.receipt.mockResolvedValue(true);
});
describe("background domain review worker", () => {
  it("saves a passing review without authorizing execution or generating acceptance tests", async () => {
    await runProblemPromptReviewTick("org");
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Ready", promptHash: job.prompt_hash }));
    expect(mock.acceptance).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("revises a failing prompt and retests on a later scheduler tick", async () => {
    mock.evaluate.mockResolvedValue({ verdict: "Needs revision", changes: ["Preserve Edit"], suggestedRevision: "Revised prompt" });
    mock.revise.mockResolvedValue({ prompt: { contentHash: "b".repeat(64) } });
    await runProblemPromptReviewTick("org");
    expect(mock.revise).toHaveBeenCalledOnce();
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Testing", attempts: 1, promptHash: "b".repeat(64) }));
  });
  it("caps attempts and preserves approval boundaries", async () => {
    mock.claim.mockResolvedValue({ ...job, attempts: 3 });
    await runProblemPromptReviewTick("org");
    expect(mock.evaluate).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Needs attention" }));
    mock.claim.mockResolvedValue(job); mock.workflow.mockResolvedValue({ ...workflow, prompt: { ...workflow.prompt, status: "Approved" } });
    await runProblemPromptReviewTick("org"); expect(mock.evaluate).not.toHaveBeenCalled();
  });
  it("does not run in Observe mode or a simulated workspace", async () => {
    mock.policy.mockResolvedValue("Observe"); await runProblemPromptReviewTick("org"); expect(mock.claim).not.toHaveBeenCalled();
    mock.policy.mockResolvedValue("Recommend"); mock.persistence.mockReturnValue("memory");
    await runProblemPromptReviewTick("org"); expect(mock.claim).not.toHaveBeenCalled();
  });
  it("rejects concurrent prompt changes instead of marking a stale test ready", async () => {
    mock.workflow.mockResolvedValueOnce(workflow).mockResolvedValueOnce({ ...workflow, prompt: { ...workflow.prompt, contentHash: "b".repeat(64) } });
    await runProblemPromptReviewTick("org");
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Needs attention" }));
  });
  it("dispatches acceptance preparation only after an exact-version confirmation", async () => {
    mock.claim.mockResolvedValue({ ...job, status: "Confirmed" });
    mock.acceptance.mockResolvedValue({ storyTest: { id: "verification", promptHash: job.prompt_hash, status: "Queued" } });
    mock.execution.mockResolvedValue({ id: "verification" });
    await runProblemPromptReviewTick("org");
    expect(mock.dispatch).toHaveBeenCalledOnce(); expect(mock.evaluate).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Preparing tests" }));
  });
  it("does not dispatch after a stale confirmation", async () => {
    mock.claim.mockResolvedValue({ ...job, status: "Confirmed", prompt_hash: "b".repeat(64) });
    await runProblemPromptReviewTick("org"); expect(mock.acceptance).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("ignores results from an expired worker lease", async () => {
    mock.lease.mockResolvedValue(false);
    await runProblemPromptReviewTick("org");
    expect(mock.finish).not.toHaveBeenCalled(); expect(mock.revise).not.toHaveBeenCalled();
  });
  it("does not endlessly requeue failed acceptance tests", async () => {
    mock.claim.mockResolvedValue({ ...job, status: "Preparing tests" });
    mock.workflow.mockResolvedValue({ ...workflow, verification: { status: "Failed" } });
    await runProblemPromptReviewTick("org"); expect(mock.acceptance).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Needs attention" }));
  });
  it.each(["Recommend", "Execute with approval", "Full autonomy"])("keeps %s on human requirement confirmation", async (level) => {
    mock.policy.mockResolvedValue(level);
    await runProblemPromptReviewTick("org");
    expect(mock.accept).not.toHaveBeenCalled(); expect(mock.activation).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Ready" }));
  });
  it("accepts an exact passing automatic review with separate policy provenance", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    await runProblemPromptReviewTick("org");
    expect(mock.claim).toHaveBeenCalledWith("org", activation.occurred_at);
    expect(mock.accept).toHaveBeenCalledWith(job, expect.objectContaining({ promptHash: job.prompt_hash, attempts: 1,
      evaluation: expect.objectContaining({ verdict: "Passed", changes: [] }) }));
    expect(mock.finish).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("does not claim automatic work without an activation or available recorded budget", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge"); mock.activation.mockResolvedValue(null);
    await runProblemPromptReviewTick("org"); expect(mock.claim).not.toHaveBeenCalled();
    mock.activation.mockResolvedValue(activation); mock.budget.mockResolvedValue(false);
    await runProblemPromptReviewTick("org"); expect(mock.claim).not.toHaveBeenCalled(); expect(mock.evaluate).not.toHaveBeenCalled();
  });
  it("stops before paid evaluation if activation changes or the budget runs out", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    mock.activation.mockResolvedValueOnce(activation).mockResolvedValue(null);
    await runProblemPromptReviewTick("org"); expect(mock.evaluate).not.toHaveBeenCalled();
    mock.activation.mockResolvedValue(activation); mock.budget.mockResolvedValueOnce(true).mockResolvedValue(false);
    await runProblemPromptReviewTick("org"); expect(mock.evaluate).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Needs attention" }));
  });
  it("surfaces incomplete requirements for help without running evaluation", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    mock.workflow.mockResolvedValue({ ...workflow, readiness: { ready: false, issues: ["Expected outcome missing"] } });
    await runProblemPromptReviewTick("org");
    expect(mock.evaluate).not.toHaveBeenCalled(); expect(mock.accept).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Needs attention", failureMessage: expect.stringContaining("missing or ambiguous") }));
  });
  it("advances a saved passing review without another paid evaluation", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    const ready = { ...job, status: "Ready", attempts: 2, evaluation: { verdict: "Passed", changes: [], summary: "Passed" } };
    mock.claim.mockResolvedValue(ready);
    await runProblemPromptReviewTick("org");
    expect(mock.accept).toHaveBeenCalledWith(ready, expect.objectContaining({ attempts: 2 }));
    expect(mock.evaluate).not.toHaveBeenCalled();
  });
  it("requires the current automatic receipt before preparing acceptance tests", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    mock.claim.mockResolvedValue({ ...job, status: "Preparing tests" }); mock.receipt.mockResolvedValue(false);
    await runProblemPromptReviewTick("org");
    expect(mock.acceptance).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Needs attention" }));
  });
  it("rejects an automatic evaluation for another prompt hash", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    mock.evaluate.mockResolvedValue({ verdict: "Passed", changes: [], promptHash: "b".repeat(64) });
    await runProblemPromptReviewTick("org");
    expect(mock.accept).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(job, expect.objectContaining({ status: "Needs attention", failureMessage: expect.stringContaining("does not match") }));
  });
  it("continues policy accepted work without a human confirmation timestamp", async () => {
    mock.policy.mockResolvedValue("Automatic coding, human merge");
    mock.claim.mockResolvedValue({ ...job, status: "Preparing tests" });
    mock.acceptance.mockResolvedValue({ storyTest: { id: "verification", promptHash: job.prompt_hash, status: "Queued" } });
    mock.execution.mockResolvedValue({ id: "verification" });
    await runProblemPromptReviewTick("org");
    expect(mock.receipt).toHaveBeenCalled(); expect(mock.dispatch).toHaveBeenCalledOnce();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Preparing tests" }));
  });
  it("blocks policy accepted work if the workspace reverts to a manual mode", async () => {
    mock.claim.mockResolvedValue({ ...job, status: "Preparing tests", evaluation: { policyAcceptance: { activationId: "old" } } });
    await runProblemPromptReviewTick("org");
    expect(mock.acceptance).not.toHaveBeenCalled(); expect(mock.dispatch).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "Needs attention" }));
  });
});
