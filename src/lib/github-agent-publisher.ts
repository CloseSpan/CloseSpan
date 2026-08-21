import { Octokit } from "@octokit/rest";
import type { AgentImplementationReport } from "./agent-run-verification";
import type { AgentRunExecutionContext } from "./engineering-workflow-repository";
import { verificationReportJson } from "./engineering-workflow-repository";
import { createGithubInstallationClient } from "./github-app-auth";

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

export interface GithubPublisherDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
}

const LEGACY_TENKI_REVIEW_REQUEST_MARKER = "<!-- closespan:tenki-code-review-request:v1 -->";

function tenkiReviewRequestMarker(headSha: string, cycle: number): string {
  return `<!-- closespan:tenki-code-review-request:v2 head=${headSha.toLowerCase()} cycle=${cycle} -->`;
}

async function requestTenkiCodeReview(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  pullRequestNumber: number,
  headSha: string,
  cycle: number,
): Promise<boolean> {
  try {
    const marker = tenkiReviewRequestMarker(headSha, cycle);
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      ...repository,
      issue_number: pullRequestNumber,
      per_page: 100,
    });
    if (comments.some((comment) => (
      comment.body?.includes(marker)
      || (cycle === 0 && comment.body?.includes(LEGACY_TENKI_REVIEW_REQUEST_MARKER))
    ))) return true;
    await octokit.rest.issues.createComment({
      ...repository,
      issue_number: pullRequestNumber,
      body: [
        marker,
        `@${process.env.TENKI_REVIEWER_LOGIN?.trim() || "tenki-reviewer"} Please review this CloseSpan-generated draft pull request at commit \`${headSha.slice(0, 12)}\`.`,
      ].join("\n"),
    });
    return true;
  } catch (error) {
    console.warn("Unable to request automatic Tenki code review", {
      repository: `${repository.owner}/${repository.repo}`,
      pullRequestNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function installationClient(
  installationId: string,
  dependencies: GithubPublisherDependencies = {},
): Promise<Octokit> {
  if (dependencies.createClient) return dependencies.createClient(installationId);
  return createGithubInstallationClient(installationId);
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
  tenkiReviewRequested: boolean;
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
  const tenkiReviewRequested = await requestTenkiCodeReview(
    octokit,
    repository,
    pull.number,
    branchSha,
    0,
  );
  return {
    promptCommitSha,
    implementationCommitSha: branchSha,
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.html_url,
    tenkiReviewRequested,
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
  tenkiReviewRequested: boolean;
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
  const tenkiReviewRequested = await requestTenkiCodeReview(
    octokit,
    repository,
    pull.data.number,
    implementationCommit.commitSha,
    0,
  );
  return {
    promptCommitSha: promptCommit.commitSha,
    implementationCommitSha: implementationCommit.commitSha,
    pullRequestNumber: pull.data.number,
    pullRequestUrl: pull.data.html_url,
    tenkiReviewRequested,
  };
}

async function replyToTenkiReviewComments(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  pullRequestNumber: number,
  commentIds: number[],
  commitSha: string,
  reviewCycle: number,
): Promise<void> {
  for (const commentId of commentIds) {
    try {
      await octokit.rest.pulls.createReplyForReviewComment({
        ...repository,
        pull_number: pullRequestNumber,
        comment_id: commentId,
        body: `CloseSpan addressed this finding in \`${commitSha.slice(0, 12)}\` during autonomous Tenki review correction cycle ${reviewCycle}.`,
      });
    } catch (error) {
      console.warn("Unable to reply to a Tenki review comment", {
        repository: `${repository.owner}/${repository.repo}`,
        pullRequestNumber,
        commentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

interface ReviewThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        nodes?: Array<{
          id: string;
          isResolved: boolean;
          comments?: { nodes?: Array<{ databaseId?: number | null } | null> | null } | null;
        } | null>;
      } | null;
    } | null;
  } | null;
}

async function resolveAddressedTenkiThreads(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  pullRequestNumber: number,
  commentIds: number[],
): Promise<void> {
  if (!commentIds.length) return;
  try {
    const result = await octokit.graphql<ReviewThreadsResponse>(
      `query CloseSpanReviewThreads($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 100) { nodes { databaseId } }
              }
            }
          }
        }
      }`,
      { ...repository, number: pullRequestNumber },
    );
    const addressed = new Set(commentIds);
    const threads = result.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    for (const thread of threads) {
      if (
        !thread
        || thread.isResolved
        || !(thread.comments?.nodes ?? []).some(
          (comment) => comment?.databaseId && addressed.has(comment.databaseId),
        )
      ) continue;
      await octokit.graphql(
        `mutation CloseSpanResolveReviewThread($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread { id isResolved }
          }
        }`,
        { threadId: thread.id },
      );
    }
  } catch (error) {
    console.warn("Unable to resolve addressed Tenki review threads", {
      repository: `${repository.owner}/${repository.repo}`,
      pullRequestNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishTenkiReviewRemediation(
  context: AgentRunExecutionContext,
  report: AgentImplementationReport,
  dependencies: GithubPublisherDependencies = {},
): Promise<{
  promptCommitSha: string;
  implementationCommitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  tenkiReviewRequested: boolean;
}> {
  if (
    context.runKind !== "tenki_review_remediation"
    || !context.pullRequestNumber
    || !context.pullRequestUrl
    || !context.reviewCycle
    || !context.sourcePromptCommitSha
  ) throw new Error("Tenki review remediation is missing its approval-bound pull request context");

  const repository = repositoryParts(context.repository);
  const octokit = await installationClient(context.installationId, dependencies);
  const branch = await octokit.rest.git.getRef({
    ...repository,
    ref: `heads/${context.branchName}`,
  });
  if (branch.data.object.sha.toLowerCase() !== context.baseSha.toLowerCase()) {
    throw new Error("stale_base: pull request changed after Tenki requested corrections");
  }
  const pull = await octokit.rest.pulls.get({
    ...repository,
    pull_number: context.pullRequestNumber,
  });
  if (
    pull.data.state !== "open"
    || pull.data.head.ref !== context.branchName
    || pull.data.head.sha.toLowerCase() !== context.baseSha.toLowerCase()
    || (context.pullRequestBaseBranch && pull.data.base.ref !== context.pullRequestBaseBranch)
  ) throw new Error("stale_base: the tracked pull request no longer matches the reviewed head");

  const baseCommit = await octokit.rest.git.getCommit({
    ...repository,
    commit_sha: context.baseSha,
  });
  const reportPath = `.prompt/reports/${context.problemId}-${context.runId}-tenki-review-${context.reviewCycle}.json`;
  const correction = await createTreeCommit(octokit, repository, {
    parentSha: context.baseSha,
    baseTreeSha: baseCommit.data.tree.sha,
    message: `fix(closespan): address Tenki review cycle ${context.reviewCycle}`,
    files: [
      ...report.changedFiles.map((file) => ({
        path: file.path,
        content: file.contentBase64,
        encoding: "base64" as const,
      })),
      { path: reportPath, content: verificationReportJson(report), encoding: "utf-8" as const },
    ],
  });
  await octokit.rest.git.updateRef({
    ...repository,
    ref: `heads/${context.branchName}`,
    sha: correction.commitSha,
    force: false,
  });
  await replyToTenkiReviewComments(
    octokit,
    repository,
    context.pullRequestNumber,
    context.reviewCommentIds ?? [],
    correction.commitSha,
    context.reviewCycle,
  );
  await resolveAddressedTenkiThreads(
    octokit,
    repository,
    context.pullRequestNumber,
    context.reviewCommentIds ?? [],
  );
  const tenkiReviewRequested = await requestTenkiCodeReview(
    octokit,
    repository,
    context.pullRequestNumber,
    correction.commitSha,
    context.reviewCycle,
  );
  return {
    promptCommitSha: context.sourcePromptCommitSha,
    implementationCommitSha: correction.commitSha,
    pullRequestNumber: context.pullRequestNumber,
    pullRequestUrl: context.pullRequestUrl,
    tenkiReviewRequested,
  };
}

export async function createRepositoryArchiveUrl(
  context: Pick<AgentRunExecutionContext, "repository" | "installationId" | "baseBranch" | "baseSha">,
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
