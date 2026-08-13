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

  it("honors the configured GitHub App bot login", () => {
    vi.stubEnv("GITHUB_APP_BOT_LOGIN", "feedback-flow[bot]");
    expect(() => assertGithubActionsRunIdentity({
      claims: claims({ actor: "feedback-flow[bot]" }), repository, runId, workflowPath,
    })).not.toThrow();
  });
});
