import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImplementationPromptSnapshot } from "./engineering-prompt";

export const PDD_CLI_VERSION = "0.0.309";

export const pddVerificationStatuses = [
  "Queued",
  "Generating tests",
  "Ready for approval",
  "Failed",
  "Superseded",
] as const;

export type PddVerificationStatus = (typeof pddVerificationStatuses)[number];

export interface PddGeneratedTest {
  path: string;
  content: string;
  contentHash: string;
  command: string;
}

export interface PddVerificationView {
  id: string;
  status: PddVerificationStatus;
  userStory: string;
  promptHash: string;
  pddVersion: string;
  model: string | null;
  budgetUsd: number;
  costUsd: number | null;
  summary: string | null;
  generatedTests: PddGeneratedTest[];
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

const generatedTestSchema = z.object({
  path: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(750_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  command: z.string().trim().min(1).max(500),
}).strict();

export const pddRunnerResultSchema = z.object({
  schemaVersion: z.literal(1),
  verificationId: z.string().uuid(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["Ready for approval", "Failed"]),
  pddVersion: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(200).nullable(),
  costUsd: z.number().min(0).max(100).nullable(),
  summary: z.string().trim().min(1).max(5_000),
  generatedTests: z.array(generatedTestSchema).max(20),
  failureMessage: z.string().trim().min(1).max(5_000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "Ready for approval" && value.generatedTests.length === 0) {
    context.addIssue({ code: "custom", path: ["generatedTests"], message: "A ready Prompt Testing verification must include an executable test" });
  }
  if (value.status === "Failed" && !value.failureMessage) {
    context.addIssue({ code: "custom", path: ["failureMessage"], message: "A failed Prompt Testing verification must explain the failure" });
  }
  for (const [index, test] of value.generatedTests.entries()) {
    if (sha256(test.content) !== test.contentHash) {
      context.addIssue({ code: "custom", path: ["generatedTests", index, "contentHash"], message: "Generated test hash does not match its content" });
    }
  }
});

export type PddRunnerResult = z.infer<typeof pddRunnerResultSchema>;

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const liveApplicationTestLevels = new Set([
  "integration",
  "api",
  "component",
  "end-to-end",
]);

export function pddScenariosRequireLiveApplication(
  scenarios: ReadonlyArray<{ testLevel: string }>,
): boolean {
  return scenarios.some((scenario) => liveApplicationTestLevels.has(scenario.testLevel));
}

export function pddGeneratedTestsReferenceLiveApplication(
  tests: ReadonlyArray<{ content: string }>,
): boolean {
  return tests.some((test) => /\bCLOSESPAN_APP_URL\b/.test(test.content));
}

function pddUsesNativeRuntimeHarness(
  snapshot: ImplementationPromptSnapshot,
  tests: ReadonlyArray<{ path: string; command: string }>,
): boolean {
  const nativeCommand = /(?:^|\s)(?:xcodebuild|swift|\.\/gradlew|gradlew|flutter\s+test)(?:\s|$)/i;
  const nativeArtifact = /\.(?:swift|m|mm|kt|kts|java|dart)$/i;
  return tests.length > 0
    && tests.every((test) => nativeArtifact.test(test.path))
    && (
      tests.some((test) => nativeCommand.test(test.command))
      || snapshot.ticket.requiredCommands.some((command) => nativeCommand.test(command))
    );
}

function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

export function validateGeneratedTests(
  result: PddRunnerResult,
  snapshot: ImplementationPromptSnapshot,
): PddRunnerResult {
  const parsed = pddRunnerResultSchema.parse(result);
  const commands = new Set(snapshot.ticket.requiredCommands);
  for (const test of parsed.generatedTests) {
    if (test.path.startsWith("/") || test.path.split("/").includes("..")) {
      throw new Error(`Prompt Testing returned an unsafe test path: ${test.path}`);
    }
    if (!/(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/i.test(test.path)) {
      throw new Error(`Prompt Testing returned a non-test artifact: ${test.path}`);
    }
    if (!snapshot.ticket.permittedPaths.some((pattern) => pathMatches(pattern, test.path))) {
      throw new Error(`Prompt Testing returned a test outside the ticket's permitted paths: ${test.path}`);
    }
    if (!commands.has(test.command)) {
      throw new Error(`Prompt Testing selected a validation command that was not approved: ${test.command}`);
    }
  }
  if (
    parsed.status === "Ready for approval"
    && pddScenariosRequireLiveApplication(snapshot.ticket.testScenarios)
    && !pddUsesNativeRuntimeHarness(snapshot, parsed.generatedTests)
    && !pddGeneratedTestsReferenceLiveApplication(parsed.generatedTests)
  ) {
    throw new Error(
      "Prompt Testing live application tests must read the VM-local base URL from CLOSESPAN_APP_URL",
    );
  }
  return parsed;
}

export function renderPddPrompt(
  userStory: string,
  snapshot: ImplementationPromptSnapshot,
): string {
  const ticket = snapshot.ticket;
  const criteria = ticket.acceptanceCriteria
    .map((criterion) => `- ${criterion.id}: ${criterion.statement}`)
    .join("\n");
  const scenarios = ticket.testScenarios
    .map((scenario) => `- ${scenario.id} (${scenario.testLevel})\n  Given ${scenario.given}\n  When ${scenario.when}\n  Then ${scenario.then}`)
    .join("\n");
  return [
    "Generate executable acceptance tests for the proposed product change.",
    "Treat the user story and acceptance criteria as the contract. Do not implement the solution.",
    "Use only the repository's existing test framework and approved validation commands.",
    "The test must fail when the reported behavior is present and pass only when the expected behavior is implemented.",
    "For API, component, or end-to-end scenarios, read the isolated application base URL from process.env.CLOSESPAN_APP_URL. Do not hard-code a host or contact any other network destination.",
    "Do not use external network access, live credentials, production data, snapshots without assertions, or timing-dependent sleeps.",
    "",
    "## Product-manager user story",
    userStory,
    "",
    "## Current behavior",
    ticket.currentBehavior,
    "",
    "## Expected behavior",
    ticket.expectedBehavior,
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "## Test scenarios",
    scenarios,
    "",
    "## Regression risks",
    ...ticket.regressionScenarios.map((item) => `- ${item}`),
    "",
    "## Negative cases",
    ...ticket.negativeScenarios.map((item) => `- ${item}`),
  ].join("\n");
}
