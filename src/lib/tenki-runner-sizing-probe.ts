import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { createGithubInstallationClient } from "./github-app-auth";
import { executionProfileExecutor, type ExecutionProfileVersion } from "./execution-profile";
import {
  assertGithubActionsRunnerLabel,
  githubActionsRunnerLabel,
} from "./github-actions-runner-label";
import {
  failTenkiRunnerSizingProbe,
  markTenkiRunnerSizingProbeDispatched,
  queueTenkiRunnerSizingProbe,
  type TenkiRunnerSizingProbe,
} from "./tenki-runner-sizing-probe-repository";
import {
  type TenkiWorkloadClass,
} from "./tenki-runner-sizing";

export const TENKI_RUNNER_SIZING_WORKFLOW_PATH =
  ".github/workflows/closespan-runner-sizing.yml";
const PROBE_REF_PREFIX = "closespan/probes";

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

function decodedGithubFile(data: unknown): Buffer {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !("type" in data) || data.type !== "file"
    || !("encoding" in data) || data.encoding !== "base64"
    || !("content" in data) || typeof data.content !== "string") {
    throw new Error("The Tenki sizing workflow is not a readable repository file");
  }
  return Buffer.from(data.content.replaceAll("\n", ""), "base64");
}

function githubStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : null;
}

async function ensureProbeRef(
  github: Octokit,
  repository: { owner: string; repo: string },
  probeId: string,
  sourceSha: string,
): Promise<string> {
  const branch = `${PROBE_REF_PREFIX}/${probeId}`;
  try {
    const existing = await github.rest.git.getRef({ ...repository, ref: `heads/${branch}` });
    if (existing.data.object.sha.toLowerCase() !== sourceSha.toLowerCase()) {
      throw new Error("Existing Tenki sizing ref does not match the detected repository commit");
    }
  } catch (error) {
    if (githubStatus(error) !== 404) throw error;
    await github.rest.git.createRef({ ...repository, ref: `refs/heads/${branch}`, sha: sourceSha });
  }
  return branch;
}

export interface TenkiRunnerSizingProbeDispatchDependencies {
  createClient?: (installationId: string) => Promise<Octokit> | Octokit;
}

export async function queueAndDispatchTenkiRunnerSizingProbe(input: {
  orgId: string;
  installationId: string;
  profile: ExecutionProfileVersion;
  sourceSha: string;
  workflowSha256: string;
  workloadClass: TenkiWorkloadClass;
  workloadReasons: string[];
  callbackBaseUrl: string;
}, dependencies: TenkiRunnerSizingProbeDispatchDependencies = {}): Promise<TenkiRunnerSizingProbe> {
  const executor = executionProfileExecutor(input.profile.config);
  if (executor.kind !== "tenki_github_actions") {
    throw new Error("Sizing probes require a Tenki GitHub Actions profile");
  }
  assertGithubActionsRunnerLabel(executor.runnerLabel);
  const selectedGithubRunnerLabel = githubActionsRunnerLabel(executor);
  if (!/^[a-f0-9]{64}$/.test(input.workflowSha256)) {
    throw new Error("The Tenki sizing workflow must be hashed before dispatch");
  }
  const commands = [
    ...input.profile.config.installCommands,
    ...input.profile.config.buildCommands,
    ...input.profile.config.typecheckCommands,
    ...input.profile.config.testCommands,
  ].filter((command) => !command.includes("CloseSpanPDDTests"))
    .slice(0, 12);
  if (commands.length === 0) {
    throw new Error("Repository analysis did not find a command to size on Tenki");
  }
  const probe = await queueTenkiRunnerSizingProbe({
    orgId: input.orgId,
    profile: input.profile,
    sourceSha: input.sourceSha,
    workflowPath: TENKI_RUNNER_SIZING_WORKFLOW_PATH,
    workflowSha256: input.workflowSha256,
    runnerLabel: executor.runnerLabel,
    workloadClass: input.workloadClass,
    workloadReasons: input.workloadReasons,
    probeCommands: commands,
    workingDirectory: input.profile.config.workingDirectory,
  });
  if (probe.status !== "Queued") return probe;

  const repository = repositoryParts(input.profile.repository);
  const github = dependencies.createClient
    ? await dependencies.createClient(input.installationId)
    : await createGithubInstallationClient(input.installationId);
  const workflow = await github.rest.repos.getContent({
    ...repository,
    path: probe.workflowPath,
    ref: input.sourceSha,
  });
  const actualHash = createHash("sha256").update(decodedGithubFile(workflow.data)).digest("hex");
  if (actualHash !== probe.workflowSha256) {
    throw new Error("Tenki sizing workflow no longer matches repository analysis");
  }
  const ref = await ensureProbeRef(github, repository, probe.id, input.sourceSha);
  try {
    await github.rest.actions.createWorkflowDispatch({
      ...repository,
      workflow_id: probe.workflowPath,
      ref,
      inputs: {
        closespan_probe_id: probe.id,
        closespan_org_id: input.orgId,
        closespan_callback_url: `${input.callbackBaseUrl}/api/internal/tenki-runner-sizing/${probe.id}`,
        closespan_profile_hash: input.profile.contentHash,
        closespan_runner_label: selectedGithubRunnerLabel,
      },
    });
    return markTenkiRunnerSizingProbeDispatched({ orgId: input.orgId, probeId: probe.id });
  } catch (error) {
    await failTenkiRunnerSizingProbe({
      orgId: input.orgId,
      probeId: probe.id,
      code: "dispatch_failed",
      message: error instanceof Error ? error.message : "Tenki runner sizing dispatch failed",
    });
    throw error;
  }
}
