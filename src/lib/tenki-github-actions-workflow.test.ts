import { describe, expect, it, vi } from "vitest";
import {
  TENKI_RUNNER_SETUP_BRANCH,
  TENKI_RUNNER_SIZING_WORKFLOW_PATH,
  TENKI_RUNNER_WORKFLOW_PATH,
  TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
  approveAndMergeTenkiRunnerWorkflow,
  installTenkiRunnerWorkflow,
} from "./tenki-github-actions-workflow";

const template = "name: CloseSpan runner\non: workflow_dispatch\n";
const runtimeTemplate = "name: CloseSpan runtime verifier\non: workflow_dispatch\n";
const sizingTemplate = "name: CloseSpan runner sizing\non: workflow_dispatch\n";
const baseSha = "a".repeat(40);

function notFound(): Error & { status: number } {
  return Object.assign(new Error("not found"), { status: 404 });
}

function github(input: {
  defaultWorkflow?: string | null;
  proposedWorkflow?: string | null;
  defaultRuntimeWorkflow?: string | null;
  proposedRuntimeWorkflow?: string | null;
  defaultSizingWorkflow?: string | null;
  proposedSizingWorkflow?: string | null;
  setupBranchExists?: boolean;
  existingPull?: { number: number; html_url: string };
} = {}) {
  const createRef = vi.fn().mockResolvedValue({ data: {} });
  const createOrUpdateFileContents = vi.fn().mockResolvedValue({ data: {} });
  const createPull = vi.fn().mockResolvedValue({
    data: { number: 12, html_url: "https://github.example/pull/12" },
  });
  const getRef = vi.fn(async ({ ref }: { ref: string }) => {
    if (ref === "heads/main") return { data: { object: { sha: baseSha } } };
    if (input.setupBranchExists) return { data: { object: { sha: "b".repeat(40) } } };
    throw notFound();
  });
  const getContent = vi.fn(async ({ ref, path }: { ref: string; path: string }) => {
    const runtime = path === TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH;
    const sizing = path === TENKI_RUNNER_SIZING_WORKFLOW_PATH;
    const content = ref === baseSha
      ? runtime ? input.defaultRuntimeWorkflow ?? null : sizing ? input.defaultSizingWorkflow ?? null : input.defaultWorkflow ?? null
      : runtime ? input.proposedRuntimeWorkflow ?? null : sizing ? input.proposedSizingWorkflow ?? null : input.proposedWorkflow ?? null;
    if (content === null) throw notFound();
    return {
      data: {
        type: "file",
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      },
    };
  });
  return {
    client: {
      rest: {
        git: { getRef, createRef },
        repos: { getContent, createOrUpdateFileContents },
        pulls: {
          list: vi.fn().mockResolvedValue({ data: input.existingPull ? [input.existingPull] : [] }),
          create: createPull,
        },
      },
    },
    createRef,
    createOrUpdateFileContents,
    createPull,
  };
}

describe("Tenki runner workflow installer", () => {
  it("accepts the reviewed workflow already installed on the default branch", async () => {
    const mock = github({ defaultWorkflow: template, defaultRuntimeWorkflow: runtimeTemplate, defaultSizingWorkflow: sizingTemplate });
    await expect(installTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toEqual({
      status: "installed",
      workflowPath: ".github/workflows/closespan-agent-runner.yml",
      pullRequestNumber: null,
      pullRequestUrl: null,
    });
    expect(mock.createRef).not.toHaveBeenCalled();
    expect(mock.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it("proposes an absent workflow on a stable setup branch and opens a PR", async () => {
    const mock = github();
    await expect(installTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toMatchObject({
      status: "pull_request",
      pullRequestNumber: 12,
    });
    expect(mock.createRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: `refs/heads/${TENKI_RUNNER_SETUP_BRANCH}`,
      sha: baseSha,
    }));
    expect(mock.createOrUpdateFileContents).toHaveBeenCalledWith(expect.objectContaining({
      branch: TENKI_RUNNER_SETUP_BRANCH,
      content: Buffer.from(template).toString("base64"),
    }));
    expect(mock.createOrUpdateFileContents).toHaveBeenCalledWith(expect.objectContaining({
      path: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
      branch: TENKI_RUNNER_SETUP_BRANCH,
      content: Buffer.from(runtimeTemplate).toString("base64"),
    }));
    expect(mock.createOrUpdateFileContents).toHaveBeenCalledWith(expect.objectContaining({
      path: TENKI_RUNNER_SIZING_WORKFLOW_PATH,
      branch: TENKI_RUNNER_SETUP_BRANCH,
      content: Buffer.from(sizingTemplate).toString("base64"),
    }));
    expect(mock.createPull).toHaveBeenCalledOnce();
  });

  it("fails closed instead of overwriting a repository-owned workflow", async () => {
    const mock = github({ defaultWorkflow: "name: repository workflow\n" });
    await expect(installTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).rejects.toThrow(
      "A different workflow already exists",
    );
    expect(mock.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it("reuses an existing setup PR without rewriting the reviewed workflow", async () => {
    const mock = github({
      setupBranchExists: true,
      proposedWorkflow: template,
      proposedRuntimeWorkflow: runtimeTemplate,
      proposedSizingWorkflow: sizingTemplate,
      existingPull: { number: 7, html_url: "https://github.example/pull/7" },
    });
    await expect(installTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toMatchObject({
      status: "pull_request",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.example/pull/7",
    });
    expect(mock.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(mock.createPull).not.toHaveBeenCalled();
  });
});

function mergeGithub(input: {
  changedFiles?: Array<{ filename: string; status: string }>;
  runs?: Array<{
    id: number;
    workflow_id: number;
    status: string;
    conclusion: string | null;
    name: string;
  }>;
  baseRuns?: Array<{
    id: number;
    workflow_id: number;
    status: string;
    conclusion: string | null;
    name: string;
  }>;
  defaultWorkflow?: string | null;
  proposedWorkflow?: string | null;
  defaultRuntimeWorkflow?: string | null;
  proposedRuntimeWorkflow?: string | null;
  defaultSizingWorkflow?: string | null;
  proposedSizingWorkflow?: string | null;
} = {}) {
  const headSha = "b".repeat(40);
  const mergedSha = "c".repeat(40);
  const changedFiles = input.changedFiles ?? [{
    filename: TENKI_RUNNER_WORKFLOW_PATH,
    status: "added",
  }, {
    filename: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH,
    status: "added",
  }, {
    filename: TENKI_RUNNER_SIZING_WORKFLOW_PATH,
    status: "added",
  }];
  const getContent = vi.fn(async ({ ref, path }: { ref: string; path: string }) => {
    const runtime = path === TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH;
    const sizing = path === TENKI_RUNNER_SIZING_WORKFLOW_PATH;
    const content = ref === baseSha
      ? runtime ? input.defaultRuntimeWorkflow ?? null : sizing ? input.defaultSizingWorkflow ?? null : input.defaultWorkflow ?? null
      : runtime ? input.proposedRuntimeWorkflow ?? runtimeTemplate : sizing ? input.proposedSizingWorkflow ?? sizingTemplate : input.proposedWorkflow ?? template;
    if (content === null) throw notFound();
    return {
      data: {
        type: "file",
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      },
    };
  });
  const merge = vi.fn().mockResolvedValue({
    data: { merged: true, sha: mergedSha, message: "Pull Request successfully merged" },
  });
  const client = {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: baseSha } } }),
      },
      repos: { getContent },
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            draft: false,
            base: { ref: "main" },
            head: {
              ref: TENKI_RUNNER_SETUP_BRANCH,
              sha: headSha,
              repo: { full_name: "acme/app" },
            },
            changed_files: changedFiles.length,
            html_url: "https://github.example/pull/12",
            merged: false,
            merge_commit_sha: null,
          },
        }),
        listFiles: vi.fn().mockResolvedValue({ data: changedFiles }),
        merge,
      },
      actions: {
        listWorkflowRunsForRepo: vi.fn(async ({ head_sha }: { head_sha: string }) => ({
          data: { workflow_runs: head_sha === baseSha ? input.baseRuns ?? [] : input.runs ?? [] },
        })),
      },
    },
  };
  return { client, merge, headSha, mergedSha };
}

describe("Tenki runner workflow approval", () => {
  it("revalidates the exact setup PR and merges after reported checks pass", async () => {
    const mock = mergeGithub({
      runs: [{
        id: 91,
        workflow_id: 8,
        status: "completed",
        conclusion: "success",
        name: "CI",
      }],
    });

    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toEqual({
      status: "merged",
      workflowPath: TENKI_RUNNER_WORKFLOW_PATH,
      pullRequestNumber: 12,
      pullRequestUrl: "https://github.example/pull/12",
      mergedSha: mock.mergedSha,
      githubActionsChecksPassed: 1,
      preexistingGithubActionsFailures: 0,
    });
    expect(mock.merge).toHaveBeenCalledWith(expect.objectContaining({
      pull_number: 12,
      sha: mock.headSha,
      merge_method: "squash",
    }));
  });

  it("fails closed when the setup PR contains any additional file", async () => {
    const mock = mergeGithub({
      changedFiles: [
        { filename: TENKI_RUNNER_WORKFLOW_PATH, status: "added" },
        { filename: TENKI_RUNTIME_VERIFIER_WORKFLOW_PATH, status: "added" },
        { filename: TENKI_RUNNER_SIZING_WORKFLOW_PATH, status: "added" },
        { filename: "README.md", status: "modified" },
      ],
    });
    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).rejects.toThrow(
      "unexpected file changes",
    );
    expect(mock.merge).not.toHaveBeenCalled();
  });

  it("waits for GitHub Actions and rejects a failed latest run", async () => {
    const pending = mergeGithub({
      runs: [{
        id: 91,
        workflow_id: 8,
        status: "in_progress",
        conclusion: null,
        name: "CI",
      }],
    });
    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => pending.client as never, template, runtimeTemplate, sizingTemplate })).rejects.toThrow(
      "Wait for GitHub Actions to finish: CI",
    );

    const failed = mergeGithub({
      runs: [{
        id: 92,
        workflow_id: 8,
        status: "completed",
        conclusion: "failure",
        name: "CI",
      }],
    });
    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => failed.client as never, template, runtimeTemplate, sizingTemplate })).rejects.toThrow(
      "Resolve the GitHub Actions checks newly failing on this setup PR first: CI",
    );
  });

  it("does not attribute a check already failing on the exact base commit to the setup PR", async () => {
    const failure = {
      id: 92,
      workflow_id: 8,
      status: "completed",
      conclusion: "failure",
      name: "Swift",
    };
    const mock = mergeGithub({
      runs: [failure],
      baseRuns: [{ ...failure, id: 91 }],
    });

    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toMatchObject({
      status: "merged",
      githubActionsChecksPassed: 0,
      preexistingGithubActionsFailures: 1,
    });
    expect(mock.merge).toHaveBeenCalledOnce();
  });

  it("is idempotent when the exact workflow is already installed", async () => {
    const mock = mergeGithub({
      defaultWorkflow: template,
      defaultRuntimeWorkflow: runtimeTemplate,
      defaultSizingWorkflow: sizingTemplate,
    });
    await expect(approveAndMergeTenkiRunnerWorkflow({
      installationId: "42",
      repository: "acme/app",
      defaultBranch: "main",
      pullRequestNumber: 12,
    }, { createClient: async () => mock.client as never, template, runtimeTemplate, sizingTemplate })).resolves.toMatchObject({
      status: "installed",
      mergedSha: baseSha,
    });
    expect(mock.merge).not.toHaveBeenCalled();
  });
});
