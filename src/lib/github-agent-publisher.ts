import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { verificationReportJson } from "./engineering-workflow-repository";

function githubConfiguration() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  if (!appId || !privateKey)
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for live agent publication");
  return { appId, privateKey };
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

interface GithubPublisherDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
}

async function installationClient(
  installationId: string,
  dependencies: GithubPublisherDependencies = {},
): Promise<Octokit> {
  if (dependencies.createClient) return dependencies.createClient(installationId);
  const { appId, privateKey } = githubConfiguration();
  const auth = createAppAuth({ appId, privateKey, installationId: Number(installationId) });
  const installation = await auth({ type: "installation" });
  return new Octokit({ auth: installation.token });
}

async function createTreeCommit(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  input: {
    parentSha: string;
    baseTreeSha: string;
    message: string;
    files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" }>;
  },
): Promise<{ commitSha: string; treeSha: string }> {
  const tree = await Promise.all(input.files.map(async (file) => {
    if (file.content === null) return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: null };
    const blob = await octokit.rest.git.createBlob({
      ...repository,
      content: file.content,
      encoding: file.encoding ?? "utf-8",
    });
    return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
  }));
  const nextTree = await octokit.rest.git.createTree({
    ...repository,
    base_tree: input.baseTreeSha,
    tree,
  });
  const commit = await octokit.rest.git.createCommit({
    ...repository,
    message: input.message,
    tree: nextTree.data.sha,
    parents: [input.parentSha],
  });
  return { commitSha: commit.data.sha, treeSha: nextTree.data.sha };
}

function pullRequestBody(context: AgentRunExecutionContext, report: AgentImplementationReport): string {
  const criteria = report.criteria.map((item) => `- [${item.status === "Passed" ? "x" : " "}] **${item.criterionId}** — ${item.status}: ${item.evidence}`).join("\n");
  const tests = report.tests.map((item) => `- ${item.status === "passed" ? "✅" : item.status === "failed" ? "❌" : "⏸️"} \`${item.command}\` — ${item.status}`).join("\n");
  return [
    "## CloseSpan approval-bound implementation",
    "",
    report.summary,
    "",
    `- Approval: \`${context.approvalId}\``,
    `- Prompt: \`${context.promptHash}\``,
    `- Approved base: \`${context.baseBranch}@${context.baseSha}\``,
    `- Prompt artifact: \`${context.promptArtifactPath}\``,
    "",
    "### Acceptance evidence",
    criteria || "- No criterion evidence reported.",
    "",
    "### Validation commands",
    tests || "- No commands reported.",
    "",
    "### Test files added or modified",
    report.testFiles.map((file) => `- \`${file}\``).join("\n") || "- None reported.",
    "",
    "### Remaining risks",
    report.remainingRisks.map((item) => `- ${item}`).join("\n") || "- None reported.",
    "",
    "### Manual verification still required",
    report.manualVerification.map((item) => `- ${item}`).join("\n") || "- Follow the release verification procedure in the approved prompt.",
    "",
    "> This draft PR was created by a single-use CloseSpan approval. It was not merged or deployed automatically.",
  ].join("\n");
}

async function existingPublication(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
): Promise<{
  promptCommitSha: string;
  implementationCommitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
} | null> {
  let branchSha: string;
  try {
    const ref = await octokit.rest.git.getRef({ ...repository, ref: `heads/${context.branchName}` });
    branchSha = ref.data.object.sha;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) return null;
    throw error;
  }
  const implementation = await octokit.rest.git.getCommit({ ...repository, commit_sha: branchSha });
  const promptCommitSha = implementation.data.parents[0]?.sha;
  if (!promptCommitSha) throw new Error("Existing CloseSpan branch has no prompt parent commit");
  const prompt = await octokit.rest.git.getCommit({ ...repository, commit_sha: promptCommitSha });
  if (prompt.data.parents[0]?.sha !== context.baseSha)
    throw new Error("Existing CloseSpan branch does not match the approved base commit");
  const pulls = await octokit.rest.pulls.list({
    ...repository,
    state: "open",
    head: `${repository.owner}:${context.branchName}`,
    base: context.baseBranch,
    per_page: 10,
  });
  const pull = pulls.data[0] ?? (await octokit.rest.pulls.create({
    ...repository,
    title: `${context.problemId}: ${context.promptSnapshot.evidence.title}`,
    head: context.branchName,
    base: context.baseBranch,
    body: pullRequestBody(context, report),
    draft: true,
  })).data;
  return {
    promptCommitSha,
    implementationCommitSha: branchSha,
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.html_url,
  };
}

export async function publishAgentRun(
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
  dependencies: GithubPublisherDependencies = {},
): Promise<{
  promptCommitSha: string;
  implementationCommitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}> {
  const repository = repositoryParts(context.repository);
  const octokit = await installationClient(context.installationId, dependencies);
  const baseRef = await octokit.rest.git.getRef({ ...repository, ref: `heads/${context.baseBranch}` });
  if (baseRef.data.object.sha !== context.baseSha)
    throw new Error("stale_base: repository branch moved after approval");
  const existing = await existingPublication(octokit, repository, context, report);
  if (existing) return existing;
  const baseCommit = await octokit.rest.git.getCommit({ ...repository, commit_sha: context.baseSha });
  const promptCommit = await createTreeCommit(octokit, repository, {
    parentSha: context.baseSha,
    baseTreeSha: baseCommit.data.tree.sha,
    message: `chore(closespan): add approved prompt for ${context.problemId}`,
    files: [{ path: context.promptArtifactPath, content: context.promptContent }],
  });
  const reportPath = `.prompt/reports/${context.problemId}-${context.runId}.json`;
  const implementationCommit = await createTreeCommit(octokit, repository, {
    parentSha: promptCommit.commitSha,
    baseTreeSha: promptCommit.treeSha,
    message: `fix(closespan): implement ${context.problemId}`,
    files: [
      ...report.changedFiles.map((file) => ({ path: file.path, content: file.contentBase64, encoding: "base64" as const })),
      { path: reportPath, content: verificationReportJson(report), encoding: "utf-8" as const },
    ],
  });
  await octokit.rest.git.createRef({
    ...repository,
    ref: `refs/heads/${context.branchName}`,
    sha: implementationCommit.commitSha,
  });
  const pull = await octokit.rest.pulls.create({
    ...repository,
    title: `${context.problemId}: ${context.promptSnapshot.evidence.title}`,
    head: context.branchName,
    base: context.baseBranch,
    body: pullRequestBody(context, report),
    draft: true,
  });
  return {
    promptCommitSha: promptCommit.commitSha,
    implementationCommitSha: implementationCommit.commitSha,
    pullRequestNumber: pull.data.number,
    pullRequestUrl: pull.data.html_url,
  };
}

export async function createRepositoryArchiveUrl(
  context: AgentRunExecutionContext,
  dependencies: GithubPublisherDependencies = {},
): Promise<string> {
  const repository = repositoryParts(context.repository);
  const octokit = await installationClient(context.installationId, dependencies);
  const baseRef = await octokit.rest.git.getRef({ ...repository, ref: `heads/${context.baseBranch}` });
  if (baseRef.data.object.sha !== context.baseSha)
    throw new Error("stale_base: repository branch moved after approval");
  const response = await octokit.request("GET /repos/{owner}/{repo}/tarball/{ref}", {
    ...repository,
    ref: context.baseSha,
    request: { redirect: "manual" },
  });
  const location = response.headers.location;
  if (!location) throw new Error("GitHub did not return a short-lived repository archive URL");
  return location;
}
