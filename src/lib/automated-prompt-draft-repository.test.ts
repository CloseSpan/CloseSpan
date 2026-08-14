import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAutomatedEngineeringDraft,
  createNextAutomatedPromptDraft,
} from "./automated-prompt-draft-repository";
import { ticketReadiness } from "./engineering-prompt";
import { getEngineeringWorkflow } from "./engineering-workflow-repository";
import { updateWorkspacePolicy } from "./workspace-settings-repository";
import { primaryProblem } from "./seed";
import { listPromptReviewNotifications } from "./prompt-review-notification-repository";

describe("automatic engineering prompt drafts", () => {
  it("prioritizes confirmed matches and excludes rejected suspected repositories", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/lib/automated-prompt-draft-repository.ts"),
      "utf8",
    );
    const ordering = source.slice(source.indexOf("ORDER BY\n            (match.status='Confirmed')"));
    expect(ordering.indexOf("(match.status='Confirmed') DESC")).toBeLessThan(
      ordering.indexOf("(allowed.repository=problem.suspected_repository) DESC"),
    );
    expect(source).toContain("rejected.status='Rejected'");
  });

  it("refreshes repository matches independently of automatic prompt drafting", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/lib/automated-prompt-draft-repository.ts"),
      "utf8",
    );
    expect(source.indexOf("await refreshPendingProblemRepositoryMatches(orgId)")).toBeLessThan(
      source.indexOf('if (policy.mode !== "automatic")'),
    );
  });

  it("keeps direct product-manager generation available in manual drafting mode", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/lib/automated-prompt-draft-repository.ts"),
      "utf8",
    );
    expect(source).toContain('mode: "automatic"');
    expect(source).toContain("minimumEvidence: 1");
    expect(source).toContain("await nextPostgresCandidate(orgId, directDraftPolicy, problemId)");
    expect(source).toContain("return createForCandidate(orgId, directDraftPolicy, candidate)");
  });

  it("groups prompt readiness by the latest investigation identity", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/lib/automated-prompt-draft-repository.ts"),
      "utf8",
    );
    const readinessQuery = source.slice(
      source.indexOf("export async function readPromptDraftReadiness"),
      source.indexOf("const row = result.rows[0]"),
    );

    expect(readinessQuery).toContain(
      "GROUP BY problem.org_id,problem.id,investigation.id,investigation.confidence",
    );
    expect(readinessQuery).toContain("'clusterMatch',avg(");
    expect(readinessQuery).toContain("'evidenceQuality',avg(");
    expect(readinessQuery).toContain("'ambiguityPenalty',avg(");
  });

  it("builds a test-ready bug specification when repository context is available", () => {
    const draft = buildAutomatedEngineeringDraft({
      kind: "Bug",
      title: "Large export truncation",
      statement: "Large exports omit selected rows.",
      summary: "Enterprise reporting cannot complete reliably.",
      proposedAction: "Finalize the complete object before marking the export successful.",
      recommendedTests: ["A large export contains every selected row."],
      suspectedFiles: ["src/export/**"],
      repository: "acme/app",
      baseBranch: "main",
      baseSha: "a".repeat(40),
      evidenceCount: 4,
    });
    expect(ticketReadiness(draft)).toEqual({ ready: true, issues: [] });
    expect(draft.userStory).toMatch(/^As a product user, I want /);
    expect(draft.userStory).toContain("so that affected customers can complete the workflow reliably");
    expect(draft.userStory).not.toContain("so that enterprise reporting cannot complete reliably");
    expect(draft.nonGoals).toContain("Automatic merge or deployment.");
    expect(draft.expectedBehavior).toContain("users receive the complete expected result");
    expect(draft.acceptanceCriteria[0]).toMatchObject({
      id: "AC-1",
      measurable: true,
    });
    expect(draft.acceptanceCriteria[0]?.statement).toContain("user-visible");
    expect(draft.qualityExpectations).toContain(
      "Passing commands, creating an issue, or opening a pull request is not proof of success without the requested user-visible outcome.",
    );
    expect(draft.qualityExpectations.some((item) => item.includes("as a hypothesis"))).toBe(true);
    expect(draft.releaseVerification).toContain("corrected user-visible behavior");
  });

  it("leaves an unbound draft non-executable until repository context is complete", () => {
    const draft = buildAutomatedEngineeringDraft({
      kind: "Feature request",
      title: "Scheduled reports",
      statement: "Reports can only be exported manually.",
      summary: "Teams want scheduled delivery.",
      proposedAction: "Add reviewed scheduled report delivery.",
      recommendedTests: [],
      suspectedFiles: [],
      repository: "",
      baseBranch: "main",
      baseSha: "",
      evidenceCount: 5,
    });
    expect(ticketReadiness(draft).ready).toBe(false);
  });

  it("uses the reviewed repository profile for monorepo paths and commands", () => {
    const draft = buildAutomatedEngineeringDraft({
      kind: "Bug",
      title: "Web export truncation",
      statement: "Large exports omit selected rows.",
      summary: "Reporting cannot complete reliably.",
      proposedAction: "Finalize the complete object before reporting success.",
      recommendedTests: ["A large export contains every selected row."],
      suspectedFiles: ["apps/web/src/export.ts"],
      repository: "acme/platform",
      baseBranch: "main",
      baseSha: "a".repeat(40),
      evidenceCount: 4,
      executionProfileConfig: {
        language: "typescript",
        packageManager: "pnpm",
        workingDirectory: "apps/web",
        permittedPaths: ["apps/web/**"],
        testCommands: ["pnpm test"],
        typecheckCommands: ["pnpm run typecheck"],
      },
    });
    expect(draft.permittedPaths).toEqual([
      "apps/web/src/export.ts",
      "apps/web/tests/**",
    ]);
    expect(draft.requiredCommands).toEqual([
      "pnpm test",
      "pnpm run typecheck",
    ]);
  });

  it("installs durable policy, reviewer, draft, and notification storage", async () => {
    const migration = await readFile(path.join(process.cwd(), "db/migrations/029_automated_prompt_drafts.sql"), "utf8");
    expect(migration).toContain("prompt_draft_mode");
    expect(migration).toContain("'Draft','Ready','Awaiting approval'");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS prompt_review_notifications");
  });

  it("creates a non-executable agent draft after workspace thresholds are met", async () => {
    const orgId = "org_automatic_prompt_draft_test";
    await updateWorkspacePolicy(orgId, {
      autonomyLevel: "Execute with approval",
      piiRedaction: true,
      retentionDays: 365,
      priorityWeights: { confidence: 100 },
      promptDraftPolicy: {
        mode: "automatic",
        bugReports: true,
        featureRequests: false,
        minimumEvidence: 3,
        minimumConfidence: 0.5,
        inAppNotifications: true,
        emailNotifications: true,
        reviewerId: "reviewer_product",
      },
    }, { actorId: "admin", actorName: "Admin", traceId: "policy-test" });

    const result = await createNextAutomatedPromptDraft(orgId);
    const workflow = await getEngineeringWorkflow(orgId, primaryProblem.id);
    expect(result.created).toBe(true);
    expect(workflow.prompt).toMatchObject({
      status: "Draft",
      reviewerId: "reviewer_product",
      reviewerNotificationRequested: true,
      reviewerEmailNotificationRequested: true,
    });
    expect(await listPromptReviewNotifications(orgId, "reviewer_product")).toHaveLength(1);
    expect(workflow.approval).toBeNull();
    expect(workflow.run).toBeNull();
  });
});
