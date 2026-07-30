import { z } from "zod";
import type {
  EngineeringTicketSpecification,
  ImplementationPromptSnapshot,
} from "./engineering-prompt";

const changedFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  contentBase64: z.string().max(1_500_000).nullable(),
  reason: z.string().trim().min(1).max(2_000),
});

const testResultSchema = z.object({
  command: z.string().trim().min(1).max(500),
  status: z.enum(["passed", "failed", "skipped"]),
  output: z.string().max(20_000),
});

const criterionResultSchema = z.object({
  criterionId: z.string().regex(/^AC-[1-9][0-9]*$/),
  status: z.enum(["Passed", "Failed", "Pending manual", "Not verified"]),
  evidence: z.string().trim().min(1).max(5_000),
  scenarioIds: z.array(z.string().regex(/^TEST-[1-9][0-9]*$/)).max(50),
});

export const agentImplementationReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  promptArtifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  status: z.enum(["Tests passed", "Draft PR opened", "Failed", "No changes"]),
  summary: z.string().trim().min(1).max(5_000),
  changedFiles: z.array(changedFileSchema).max(100),
  testFiles: z.array(z.string().trim().min(1).max(500)).max(100),
  tests: z.array(testResultSchema).max(30),
  criteria: z.array(criterionResultSchema).max(30),
  remainingRisks: z.array(z.string().trim().min(1).max(2_000)).max(30),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(30),
  manualVerification: z.array(z.string().trim().min(1).max(2_000)).max(30),
  logs: z.array(z.string().max(5_000)).max(200),
  independentVerification: z.object({
    provider: z.literal("Tenki Sandbox"),
    sessionId: z.string().trim().min(1).max(200),
    status: z.enum(["passed", "failed"]),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
  }).optional(),
});

export type AgentImplementationReport = z.infer<typeof agentImplementationReportSchema>;

function globMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function decodedContent(file: AgentImplementationReport["changedFiles"][number]): Uint8Array | null {
  if (file.contentBase64 === null) return null;
  return Uint8Array.from(Buffer.from(file.contentBase64, "base64"));
}

const highConfidenceSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

export function validateAgentImplementationReport(
  input: unknown,
  expected: {
    runId: string;
    promptHash: string;
    baseSha: string;
    promptArtifactPath: string;
    promptSnapshot: ImplementationPromptSnapshot;
  },
): AgentImplementationReport {
  const report = agentImplementationReportSchema.parse(input);
  if (report.runId !== expected.runId) throw new Error("Agent report run ID does not match the queued run");
  if (report.promptHash !== expected.promptHash || report.promptArtifactHash !== expected.promptHash)
    throw new Error("Agent report does not preserve the approved prompt hash");
  if (report.baseSha !== expected.baseSha.toLowerCase())
    throw new Error("Agent report base commit does not match the approved commit");

  const ticket: EngineeringTicketSpecification = expected.promptSnapshot.ticket;
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of report.changedFiles) {
    if (paths.has(file.path)) throw new Error(`Agent report repeats changed path ${file.path}`);
    paths.add(file.path);
    if (file.path === expected.promptArtifactPath)
      throw new Error("The agent may not modify the approved prompt artifact");
    if (file.path === ".prompt/README.md" || file.path === ".prompt/template.prompt.md" || file.path.startsWith(".github/workflows/"))
      throw new Error(`Agent change to protected path ${file.path} is not allowed`);
    if (file.path.startsWith("/") || file.path.split("/").includes(".."))
      throw new Error(`Agent change path ${file.path} escapes the repository root`);
    if (!ticket.permittedPaths.some((pattern) => globMatches(pattern, file.path)))
      throw new Error(`Agent change ${file.path} is outside the approved paths`);
    const content = decodedContent(file);
    if (content?.includes(0)) throw new Error(`Binary change ${file.path} is not allowed`);
    if (content && highConfidenceSecretPatterns.some((pattern) => pattern.test(new TextDecoder().decode(content))))
      throw new Error(`Potential secret detected in ${file.path}`);
    totalBytes += content?.byteLength ?? 0;
  }
  if (totalBytes > 5_000_000) throw new Error("Agent diff exceeds the 5 MB approval boundary");

  const testsByCommand = new Map(report.tests.map((test) => [test.command, test]));
  const successful = report.status === "Tests passed" || report.status === "Draft PR opened";
  const changedPaths = new Set(report.changedFiles.map((file) => file.path));
  if (new Set(report.testFiles).size !== report.testFiles.length) throw new Error("Agent report repeats a test file");
  if (report.testFiles.some((path) => !changedPaths.has(path))) throw new Error("Agent report cites a test file that is not in the final diff");
  if (successful && ticket.testScenarios.some((scenario) => scenario.testLevel !== "manual") && report.testFiles.length === 0)
    throw new Error("Successful automated acceptance requires a changed test file");
  if (successful) {
    for (const command of ticket.requiredCommands) {
      const result = testsByCommand.get(command);
      if (!result || result.status !== "passed")
        throw new Error(`Required command did not pass: ${command}`);
    }
  }

  const resultByCriterion = new Map(report.criteria.map((item) => [item.criterionId, item]));
  for (const criterion of ticket.acceptanceCriteria) {
    const result = resultByCriterion.get(criterion.id);
    if (!result) throw new Error(`Agent report is missing ${criterion.id}`);
    const scenarios = ticket.testScenarios.filter((scenario) => scenario.criterionIds.includes(criterion.id));
    const expectedScenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    if (result.scenarioIds.some((id) => !expectedScenarioIds.has(id)))
      throw new Error(`${criterion.id} cites a scenario that does not verify it`);
    const hasAutomated = scenarios.some((scenario) => scenario.testLevel !== "manual");
    if (successful && hasAutomated && result.status !== "Passed")
      throw new Error(`${criterion.id} has automated coverage but is not verified as passed`);
    if (successful && !hasAutomated && result.status !== "Pending manual")
      throw new Error(`${criterion.id} is manual-only and must remain pending manual verification`);
  }
  if (report.status === "No changes" && report.changedFiles.length)
    throw new Error("A no-change run cannot contain changed files");
  if (successful && report.changedFiles.length === 0)
    throw new Error("A successful implementation run must contain a code or test change");
  return report;
}
