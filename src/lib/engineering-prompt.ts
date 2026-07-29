import { createHash } from "node:crypto";
import { z } from "zod";
import { userStoryInputIssue } from "./user-story-prompt-test";

export const testLevels = [
  "unit",
  "integration",
  "api",
  "component",
  "end-to-end",
  "manual",
] as const;

export type TestLevel = (typeof testLevels)[number];
export type EngineeringImplementationState =
  | "Draft specification"
  | "Prompt ready"
  | "Awaiting approval"
  | "Running"
  | "Tests passed"
  | "Draft PR opened"
  | "Released"
  | "Verified";

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  measurable: boolean;
}

export interface EngineeringTestScenario {
  id: string;
  title: string;
  given: string;
  when: string;
  then: string;
  testLevel: TestLevel;
  criterionIds: string[];
}

export interface EngineeringTicketSpecification {
  id?: string;
  revision?: number;
  implementationState?: EngineeringImplementationState;
  userStory: string;
  currentBehavior: string;
  expectedBehavior: string;
  reproductionSteps: string[];
  businessOutcome: string;
  acceptanceCriteria: AcceptanceCriterion[];
  testScenarios: EngineeringTestScenario[];
  regressionScenarios: string[];
  negativeScenarios: string[];
  qualityExpectations: string[];
  requiredTestLevels: TestLevel[];
  releaseVerification: string;
  nonGoals: string[];
  permittedPaths: string[];
  requiredCommands: string[];
  repository: string;
  baseBranch: string;
  baseSha: string;
}

export interface PromptEvidence {
  problemId: string;
  title: string;
  statement: string;
  summary: string;
  severity: string;
  productArea: string;
  team: string;
  hypothesis?: string;
  assumptions: string[];
  missingInformation: string[];
  suspectedFiles: string[];
  redactedEvidence: Array<{
    source: string;
    observedAt: string;
    quote: string;
  }>;
}

export interface ImplementationPromptSnapshot {
  schemaVersion: 1;
  ticket: EngineeringTicketSpecification;
  evidence: PromptEvidence;
}

const list = z.array(z.string().trim().min(1).max(2_000)).max(50);
const criterionSchema = z.object({
  id: z.string().regex(/^AC-[1-9][0-9]*$/),
  statement: z.string().trim().min(8).max(2_000),
  measurable: z.boolean(),
});
const scenarioSchema = z.object({
  id: z.string().regex(/^TEST-[1-9][0-9]*$/),
  title: z.string().trim().min(3).max(200),
  given: z.string().trim().min(3).max(2_000),
  when: z.string().trim().min(3).max(2_000),
  then: z.string().trim().min(3).max(2_000),
  testLevel: z.enum(testLevels),
  criterionIds: z.array(z.string().regex(/^AC-[1-9][0-9]*$/)).min(1).max(20),
});

export const engineeringTicketSpecificationSchema = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    implementationState: z.enum([
      "Draft specification",
      "Prompt ready",
      "Awaiting approval",
      "Running",
      "Tests passed",
      "Draft PR opened",
      "Released",
      "Verified",
    ]).optional(),
    userStory: z.string().trim().min(15).max(2_000),
    currentBehavior: z.string().trim().min(3).max(5_000),
    expectedBehavior: z.string().trim().min(3).max(5_000),
    reproductionSteps: list.min(1),
    businessOutcome: z.string().trim().min(3).max(3_000),
    acceptanceCriteria: z.array(criterionSchema).min(1).max(30),
    testScenarios: z.array(scenarioSchema).min(1).max(50),
    regressionScenarios: list,
    negativeScenarios: list,
    qualityExpectations: list,
    requiredTestLevels: z.array(z.enum(testLevels)).min(1),
    releaseVerification: z.string().trim().min(3).max(5_000),
    nonGoals: list,
    permittedPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    requiredCommands: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
    repository: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    baseBranch: z.string().trim().regex(/^[A-Za-z0-9._/-]+$/).max(255),
    baseSha: z.string().trim().regex(/^[a-fA-F0-9]{40}$/),
  })
  .superRefine((value, context) => {
    const userStoryIssue = userStoryInputIssue(value.userStory);
    if (userStoryIssue) {
      context.addIssue({
        code: "custom",
        path: ["userStory"],
        message: userStoryIssue,
      });
    }
    const criterionIds = new Set(value.acceptanceCriteria.map((item) => item.id));
    if (criterionIds.size !== value.acceptanceCriteria.length) {
      context.addIssue({ code: "custom", path: ["acceptanceCriteria"], message: "Acceptance criterion IDs must be unique" });
    }
    const scenarioIds = new Set(value.testScenarios.map((item) => item.id));
    if (scenarioIds.size !== value.testScenarios.length) {
      context.addIssue({ code: "custom", path: ["testScenarios"], message: "Test scenario IDs must be unique" });
    }
    for (const scenario of value.testScenarios) {
      for (const criterionId of scenario.criterionIds) {
        if (!criterionIds.has(criterionId)) {
          context.addIssue({ code: "custom", path: ["testScenarios"], message: `${scenario.id} references unknown ${criterionId}` });
        }
      }
    }
    for (const criterion of value.acceptanceCriteria) {
      if (!criterion.measurable) {
        context.addIssue({ code: "custom", path: ["acceptanceCriteria"], message: `${criterion.id} must be measurable before approval` });
      }
      if (!value.testScenarios.some((scenario) => scenario.criterionIds.includes(criterion.id))) {
        context.addIssue({ code: "custom", path: ["testScenarios"], message: `${criterion.id} is not covered by a test scenario` });
      }
    }
    const configuredLevels = new Set(value.requiredTestLevels);
    for (const scenario of value.testScenarios) {
      if (!configuredLevels.has(scenario.testLevel)) {
        context.addIssue({ code: "custom", path: ["requiredTestLevels"], message: `${scenario.testLevel} is used by ${scenario.id} but is not required` });
      }
    }
  });

const engineeringTicketDraftSchema = z.object({
  userStory: z.string().trim().max(2_000).default(""),
  currentBehavior: z.string().trim().max(5_000).default(""),
  expectedBehavior: z.string().trim().max(5_000).default(""),
  reproductionSteps: list.default([]),
  businessOutcome: z.string().trim().max(3_000).default(""),
  acceptanceCriteria: z.array(criterionSchema).max(30).default([]),
  testScenarios: z.array(scenarioSchema).max(50).default([]),
  regressionScenarios: list.default([]),
  negativeScenarios: list.default([]),
  qualityExpectations: list.default([]),
  requiredTestLevels: z.array(z.enum(testLevels)).default([]),
  releaseVerification: z.string().trim().max(5_000).default(""),
  nonGoals: list.default([]),
  permittedPaths: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  requiredCommands: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  repository: z.string().trim().max(300).default(""),
  baseBranch: z.string().trim().max(255).default("main"),
  baseSha: z.string().trim().max(64).default(""),
});

export function sanitizeEngineeringTicketDraft(
  input: unknown,
): EngineeringTicketSpecification {
  return engineeringTicketDraftSchema.parse(input);
}

export function validateEngineeringTicket(
  input: unknown,
): EngineeringTicketSpecification {
  return engineeringTicketSpecificationSchema.parse(input);
}

export function ticketReadiness(input: unknown): {
  ready: boolean;
  issues: string[];
} {
  const result = engineeringTicketSpecificationSchema.safeParse(input);
  return result.success
    ? { ready: true, issues: [] }
    : {
        ready: false,
        issues: [...new Set(result.error.issues.map((issue) => issue.message))],
      };
}

function markdownList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None specified";
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.slice(0, 64) || "ticket";
}

export function promptArtifactPath(problemId: string, title: string): string {
  const safeId = problemId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `.prompt/tickets/${safeId}-${slug(title)}.prompt.md`;
}

export function renderImplementationPrompt(
  snapshot: ImplementationPromptSnapshot,
  metadata: { promptRevision: number; artifactPath: string },
): string {
  const { ticket, evidence } = snapshot;
  const criteria = ticket.acceptanceCriteria
    .map((item) => `- [ ] **${item.id}** ${item.statement}`)
    .join("\n");
  const scenarios = ticket.testScenarios
    .map((item) => [
      `### ${item.id}: ${item.title}`,
      `- Covers: ${item.criterionIds.join(", ")}`,
      `- Level: ${item.testLevel}`,
      `- Given: ${item.given}`,
      `- When: ${item.when}`,
      `- Then: ${item.then}`,
    ].join("\n"))
    .join("\n\n");
  const quotes = evidence.redactedEvidence.length
    ? evidence.redactedEvidence.map((item) => `- ${item.source} (${item.observedAt}): “${item.quote}”`).join("\n")
    : "- No customer quote is approved for repository sharing; use the problem summary only.";

  return [
    "---",
    "schema_version: 1",
    `ticket_id: ${evidence.problemId}`,
    `prompt_revision: ${metadata.promptRevision}`,
    `repository: ${ticket.repository}`,
    `base_branch: ${ticket.baseBranch}`,
    `base_sha: ${ticket.baseSha.toLowerCase()}`,
    `artifact_path: ${metadata.artifactPath}`,
    "---",
    "",
    `# ${evidence.title}`,
    "",
    "## User story",
    ticket.userStory,
    "",
    "## Problem and outcome",
    `**Current behavior:** ${ticket.currentBehavior}`,
    "",
    `**Expected behavior:** ${ticket.expectedBehavior}`,
    "",
    `**Business/customer outcome:** ${ticket.businessOutcome}`,
    "",
    `**Problem statement:** ${evidence.statement}`,
    "",
    evidence.summary,
    "",
    "## Reproduction",
    markdownList(ticket.reproductionSteps),
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "## Acceptance-to-test matrix",
    scenarios,
    "",
    "## Regression coverage",
    markdownList(ticket.regressionScenarios),
    "",
    "## Negative and failure paths",
    markdownList(ticket.negativeScenarios),
    "",
    "## Quality expectations",
    markdownList(ticket.qualityExpectations),
    "",
    "## Repository scope",
    `- Repository: ${ticket.repository}`,
    `- Approved base: ${ticket.baseBranch}@${ticket.baseSha.toLowerCase()}`,
    "- Permitted paths:",
    markdownList(ticket.permittedPaths),
    "- Suspected files (hypotheses, not confirmed root cause):",
    markdownList(evidence.suspectedFiles),
    "",
    "## Engineering context",
    `- Severity: ${evidence.severity}`,
    `- Product area: ${evidence.productArea}`,
    `- Team: ${evidence.team}`,
    `- Hypothesis: ${evidence.hypothesis ?? "Not established"}`,
    "- Assumptions:",
    markdownList(evidence.assumptions),
    "- Missing information:",
    markdownList(evidence.missingInformation),
    "",
    "## Approved redacted evidence",
    quotes,
    "",
    "## Required validation commands",
    markdownList(ticket.requiredCommands),
    "",
    "## Release verification",
    ticket.releaseVerification,
    "",
    "## Non-goals",
    markdownList(ticket.nonGoals),
    "",
    "## Agent boundaries and definition of done",
    "- Follow repository instructions, including every applicable AGENTS.md file.",
    "- Do not modify this approved prompt artifact or `.github/workflows/**`.",
    "- Keep all changes within the permitted paths and approved ticket scope.",
    "- Add or update tests that prove each automated acceptance scenario.",
    "- Run every required command and report exact results; never claim skipped or manual checks passed.",
    "- Report changed files, acceptance evidence, remaining risks, assumptions, and manual verification steps.",
    "- Stop after producing a reviewable branch and draft pull request; never merge or deploy.",
    "",
  ].join("\n");
}

export function hashImplementationPrompt(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
