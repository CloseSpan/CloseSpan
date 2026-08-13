import { afterEach, describe, expect, it, vi } from "vitest";
import { assertGithubActionsRunIdentity, type GithubActionsOidcClaims } from "./github-actions-oidc";

const runId = "11111111-1111-4111-8111-111111111111";
const repository = "owner/repo";
const workflowPath = ".github/workflows/closespan-agent-runner.yml";

function claims(overrides: Partial<GithubActionsOidcClaims> = {}): GithubActionsOidcClaims {
  const ref = `refs/heads/closespan/runs/${runId}`;
  return {
    actor: "closespan[bot]",
    event_name: "workflow_dispatch",
    repository,
    ref,
    workflow_ref: `${repository}/${workflowPath}@${ref}`,
    run_id: "123",
    sha: "a".repeat(40),
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("GitHub Actions OIDC run identity", () => {
  it("accepts the exact approval-bound workflow identity", () => {
    expect(() => assertGithubActionsRunIdentity({
      claims: claims(), repository, runId, workflowPath, reportedWorkflowRunId: 123,
    })).not.toThrow();
  });

  it("rejects a manually dispatched actor", () => {
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ actor: "some-user" }), repository, runId, workflowPath,
    })).toThrow("CloseSpan GitHub App");
  });

  it("accepts a bot dispatch on another ref only when the approved commit matches", () => {
    const ref = "refs/heads/main";
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ ref, workflow_ref: `${repository}/${workflowPath}@${ref}` }),
      repository,
      runId,
      workflowPath,
      expectedSha: "a".repeat(40),
    })).not.toThrow();
  });

  it("accepts GitHub's mixed ref claims when the workflow and approved commit match", () => {
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ ref: "refs/heads/main" }),
      repository,
      runId,
      workflowPath,
      expectedSha: "a".repeat(40),
    })).not.toThrow();
  });

  it("accepts GitHub's commit-qualified workflow claim for the approved commit", () => {
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({
        ref: "refs/heads/main",
        workflow_ref: `${repository}/${workflowPath}@${"a".repeat(40)}`,
      }),
      repository,
      runId,
      workflowPath,
      expectedSha: "a".repeat(40),
    })).not.toThrow();
  });

  it("rejects another ref when its commit is not the approved commit", () => {
    const ref = "refs/heads/main";
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ ref, workflow_ref: `${repository}/${workflowPath}@${ref}` }),
      repository,
      runId,
      workflowPath,
      expectedSha: "b".repeat(40),
    })).toThrow("immutable run ref");
  });

  it("rejects an exact commit from a different workflow", () => {
    const ref = "refs/heads/main";
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ ref, workflow_ref: `${repository}/.github/workflows/other.yml@${ref}` }),
      repository,
      runId,
      workflowPath,
      expectedSha: "a".repeat(40),
    })).toThrow("immutable run ref");
  });

  it("honors the configured GitHub App bot login", () => {
    vi.stubEnv("GITHUB_APP_BOT_LOGIN", "feedback-flow[bot]");
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ actor: "feedback-flow[bot]" }), repository, runId, workflowPath,
    })).not.toThrow();
  });
});
