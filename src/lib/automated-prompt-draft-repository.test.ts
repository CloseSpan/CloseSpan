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
    expect(draft.nonGoals).toContain("Automatic merge or deployment.");
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
