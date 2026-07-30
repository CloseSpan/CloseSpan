import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { executeTenkiCodingJob, type TenkiAgentJob } from "./tenki-coding-executor";
import { verifyAgentRunWithTenki } from "./tenki-agent-verification";

const live = process.env.RUN_TENKI_STAGING === "true";
const describeLive = live ? describe : describe.skip;

describeLive("Tenki approval-bound staging canary", () => {
  const archivePath = process.env.TENKI_STAGING_ARCHIVE_PATH ?? "";
  const reportPath = process.env.TENKI_STAGING_REPORT_PATH ?? "";
  const baseSha = process.env.TENKI_STAGING_BASE_SHA ?? "";
  const runId = randomUUID();
  const promptArtifactPath = `.prompt/tickets/STAGE-1-tenki-canary.prompt.md`;
  const promptContent = [
    "# STAGE-1: Enthusiastic greeting",
    "",
    "## User story",
    "As a user, I want generated greetings to end with an exclamation mark so that messages feel enthusiastic.",
    "",
    "## Current behavior",
    "`greeting(\"Sam\")` returns `Hello Sam`.",
    "",
    "## Expected behavior",
    "`greeting(\"Sam\")` returns `Hello Sam!`.",
    "",
    "## Acceptance criteria",
    "- AC-1: Every named greeting ends with exactly one exclamation mark.",
    "",
    "## Verification scenarios",
    "- TEST-1 (unit): Given the name Sam, when greeting is called, then it returns exactly `Hello Sam!`.",
    "",
    "## Scope",
    "- Permitted: `src/**`, `test/**`",
    "- Required command: `npm test`",
    "- Update or add an automated test that proves AC-1.",
    "- Do not change package metadata, workflows, deployment files, or this prompt.",
    "",
    "## Definition of done",
    "The implementation and automated test pass `npm test`, with criterion-level evidence in the report.",
    "",
  ].join("\n");
  const promptHash = createHash("sha256").update(promptContent).digest("hex");
  let archive = new Uint8Array();
  let archiveUrl = "";
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    if (!archivePath || !reportPath || !/^[a-f0-9]{40}$/.test(baseSha))
      throw new Error("The Tenki staging archive, report path, and base SHA are required");
    archive = new Uint8Array(await readFile(archivePath));
    server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(archive.byteLength),
      });
      response.end(archive);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not start the staging archive server");
    archiveUrl = `http://127.0.0.1:${address.port}/repository.tar.gz`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("codes in one isolated session and verifies in a second fresh session", async () => {
    const job: TenkiAgentJob = {
      schemaVersion: 1,
      orgId: "closespan-staging",
      runId,
      repository: "samshanmukh/closespan-agent-staging",
      baseSha,
      promptHash,
      promptContent,
      promptArtifactPath,
      repositoryArchiveUrl: archiveUrl,
      requiredCommands: ["npm test"],
      permittedPaths: ["src/**", "test/**"],
      acceptanceCriteria: [{ id: "AC-1", scenarioIds: ["TEST-1"] }],
      testScenarios: [{ id: "TEST-1", testLevel: "unit", criterionIds: ["AC-1"] }],
      callbackUrl: `https://www.closespan.com/api/internal/agent-runs/${runId}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      capabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"],
    };
    let implementationSessionId = "";
    const report = await executeTenkiCodingJob(job, {
      started: async (sessionId) => { implementationSessionId = sessionId; },
    });
    await writeFile(reportPath, `${JSON.stringify({ phase: "implementation", report }, null, 2)}\n`, { mode: 0o600 });
    expect(report.status).toBe("Tests passed");
    expect(report.changedFiles.map((file) => file.path).sort()).toEqual([
      "src/greeting.js",
      "test/greeting.test.js",
    ]);
    expect(report.testFiles).toContain("test/greeting.test.js");
    expect(report.tests).toEqual([expect.objectContaining({ command: "npm test", status: "passed" })]);

    const context: AgentRunExecutionContext = {
      orgId: job.orgId,
      problemId: "STAGE-1",
      runId,
      approvalId: `staging-approval-${runId}`,
      repository: job.repository,
      installationId: "staging",
      baseBranch: "master",
      baseSha,
      branchName: `closespan/STAGE-1-${runId.slice(0, 8)}-tenki-canary`,
      promptId: `staging-prompt-${runId}`,
      promptHash,
      promptContent,
      promptArtifactPath,
      promptSnapshot: {
        schemaVersion: 1,
        ticket: {
          userStory: "As a user, I want generated greetings to end with an exclamation mark so that messages feel enthusiastic.",
          currentBehavior: "Named greetings omit terminal punctuation.",
          expectedBehavior: "Named greetings end with exactly one exclamation mark.",
          reproductionSteps: ["Call greeting with the name Sam."],
          businessOutcome: "Generated messages feel enthusiastic and consistent.",
          acceptanceCriteria: [{ id: "AC-1", statement: "Every named greeting ends with exactly one exclamation mark.", measurable: true }],
          testScenarios: [{ id: "TEST-1", title: "Named greeting", given: "The name Sam", when: "greeting is called", then: "It returns Hello Sam!", testLevel: "unit", criterionIds: ["AC-1"] }],
          regressionScenarios: [],
          negativeScenarios: [],
          qualityExpectations: [],
          requiredTestLevels: ["unit"],
          releaseVerification: "Call greeting in the released application and confirm one exclamation mark.",
          nonGoals: ["Changing package metadata or deployment configuration."],
          permittedPaths: job.permittedPaths,
          requiredCommands: job.requiredCommands,
          repository: job.repository,
          baseBranch: "master",
          baseSha,
        },
        evidence: {
          problemId: "STAGE-1",
          title: "Greeting lacks enthusiastic punctuation",
          statement: "Generated greetings do not end with an exclamation mark.",
          summary: "Deterministic staging canary for approval-bound execution.",
          severity: "Low",
          productArea: "Staging",
          team: "CloseSpan",
          assumptions: [],
          missingInformation: [],
          suspectedFiles: ["src/greeting.js", "test/greeting.test.js"],
          redactedEvidence: [],
        },
      },
      expiresAt: job.expiresAt,
      allowedCapabilities: job.capabilities,
    };
    const verified = await verifyAgentRunWithTenki(context, report, {
      repositoryArchive: async () => archive,
    });
    expect(verified.status).toBe("Tests passed");
    expect(verified.independentVerification?.status).toBe("passed");
    expect(verified.independentVerification?.sessionId).not.toBe(implementationSessionId);
    await writeFile(reportPath, `${JSON.stringify({ context, report: verified }, null, 2)}\n`, { mode: 0o600 });
  }, 15 * 60_000);
});
