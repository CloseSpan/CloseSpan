import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_ACTIONS_AUDIENCE = "closespan-agent-run";
const githubActionsKeys = createRemoteJWKSet(
  new URL(`${GITHUB_ACTIONS_ISSUER}/.well-known/jwks`),
);

export interface GithubActionsOidcClaims extends JWTPayload {
  actor: string;
  event_name: string;
  repository: string;
  ref: string;
  workflow_ref: string;
  run_id: string;
  sha: string;
  job_workflow_ref?: string;
}

export async function verifyGithubActionsOidcToken(
  token: string,
): Promise<GithubActionsOidcClaims> {
  const verified = await jwtVerify(token, githubActionsKeys, {
    issuer: GITHUB_ACTIONS_ISSUER,
    audience: GITHUB_ACTIONS_AUDIENCE,
    algorithms: ["RS256"],
  });
  const claims = verified.payload;
  if (
    typeof claims.repository !== "string"
    || typeof claims.actor !== "string"
    || typeof claims.event_name !== "string"
    || typeof claims.ref !== "string"
    || typeof claims.workflow_ref !== "string"
    || typeof claims.run_id !== "string"
    || typeof claims.sha !== "string"
  ) {
    throw new Error("GitHub Actions identity token is missing required workflow claims");
  }
  return claims as GithubActionsOidcClaims;
}

export function assertGithubActionsRunIdentity(input: {
  claims: GithubActionsOidcClaims;
  repository: string;
  runId: string;
  workflowPath: string;
  reportedWorkflowRunId?: number;
  expectedSha?: string;
}): void {
  const expectedRef = `refs/heads/closespan/runs/${input.runId}`;
  const expectedWorkflowRef = `${input.repository}/${input.workflowPath}@${expectedRef}`;
  const workflowRefAtClaimedRef = `${input.repository}/${input.workflowPath}@${input.claims.ref}`;
  const exactCommitFallback = Boolean(
    input.expectedSha
    && input.claims.sha.toLowerCase() === input.expectedSha.toLowerCase()
    && input.claims.workflow_ref === workflowRefAtClaimedRef,
  );
  if (input.claims.repository !== input.repository) {
    throw new Error("GitHub Actions callback repository does not match the approval-bound run");
  }
  if (input.claims.ref !== expectedRef && !exactCommitFallback) {
    throw new Error("GitHub Actions callback ref does not match the immutable run ref");
  }
  if (input.claims.workflow_ref !== expectedWorkflowRef && !exactCommitFallback) {
    throw new Error("GitHub Actions callback workflow does not match the immutable execution profile");
  }
  if (
    input.reportedWorkflowRunId !== undefined
    && input.claims.run_id !== String(input.reportedWorkflowRunId)
  ) {
    throw new Error("GitHub Actions callback run ID does not match its identity token");
  }
  const expectedActor = process.env.GITHUB_APP_BOT_LOGIN?.trim() || "closespan[bot]";
  if (input.claims.actor !== expectedActor || input.claims.event_name !== "workflow_dispatch") {
    throw new Error("GitHub Actions callback was not dispatched by the CloseSpan GitHub App");
  }
}

export function assertGithubActionsProbeIdentity(input: {
  claims: GithubActionsOidcClaims;
  repository: string;
  probeId: string;
  workflowPath: string;
  reportedWorkflowRunId?: number;
}): void {
  const expectedRef = `refs/heads/closespan/probes/${input.probeId}`;
  const expectedWorkflowRef = `${input.repository}/${input.workflowPath}@${expectedRef}`;
  if (input.claims.repository !== input.repository) {
    throw new Error("GitHub Actions sizing callback repository does not match the bound probe");
  }
  if (input.claims.ref !== expectedRef || input.claims.workflow_ref !== expectedWorkflowRef) {
    throw new Error("GitHub Actions sizing callback does not match the immutable probe workflow");
  }
  if (
    input.reportedWorkflowRunId !== undefined
    && input.claims.run_id !== String(input.reportedWorkflowRunId)
  ) {
    throw new Error("GitHub Actions sizing callback run ID does not match its identity token");
  }
  const expectedActor = process.env.GITHUB_APP_BOT_LOGIN?.trim() || "closespan[bot]";
  if (input.claims.actor !== expectedActor || input.claims.event_name !== "workflow_dispatch") {
    throw new Error("GitHub Actions sizing probe was not dispatched by the CloseSpan GitHub App");
  }
}
