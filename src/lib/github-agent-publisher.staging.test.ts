import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { agentImplementationReportSchema } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { publishAgentRun } from "./github-agent-publisher";

const live = process.env.RUN_GITHUB_STAGING === "true";
const describeLive = live ? describe : describe.skip;

describeLive("GitHub draft-PR staging canary", () => {
  it("publishes the verified Tenki report as two commits and a draft PR", async () => {
    const reportPath = process.env.TENKI_STAGING_REPORT_PATH;
    if (!reportPath) throw new Error("TENKI_STAGING_REPORT_PATH is required");
    const payload = JSON.parse(await readFile(reportPath, "utf8")) as {
      context: AgentRunExecutionContext;
      report: unknown;
    };
    const report = agentImplementationReportSchema.parse(payload.report);
    expect(report.independentVerification?.status).toBe("passed");
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!token) throw new Error("GitHub staging authentication is unavailable");
    const publication = await publishAgentRun(payload.context, report, {
      createClient: () => new Octokit({ auth: token }),
    });
    await writeFile(reportPath, `${JSON.stringify({ ...payload, publication }, null, 2)}\n`, { mode: 0o600 });
    expect(publication.promptCommitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(publication.implementationCommitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(publication.promptCommitSha).not.toBe(publication.implementationCommitSha);
    expect(publication.pullRequestUrl).toMatch(/^https:\/\/github\.com\/samshanmukh\/closespan-agent-staging\/pull\/\d+$/);
  }, 120_000);
});
