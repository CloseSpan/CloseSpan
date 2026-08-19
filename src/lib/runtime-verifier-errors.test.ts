import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import {
  GITHUB_ACTIONS_BILLING_BLOCKED_MESSAGE,
  githubRuntimeVerificationFailureMessage,
} from "./runtime-verifier-errors";

function githubWithAnnotation(message: string): Octokit {
  return {
    rest: {
      actions: {
        listJobsForWorkflowRun: vi.fn().mockResolvedValue({
          data: { jobs: [{ id: 42, conclusion: "failure" }] },
        }),
      },
      checks: {
        listAnnotations: vi.fn().mockResolvedValue({
          data: [{ annotation_level: "failure", message }],
        }),
      },
    },
  } as unknown as Octokit;
}

describe("GitHub runtime verifier diagnostics", () => {
  it("translates GitHub billing annotations into an actionable message", async () => {
    const github = githubWithAnnotation(
      "The job was not started because recent account payments have failed or your spending limit needs to be increased.",
    );

    await expect(githubRuntimeVerificationFailureMessage(
      github,
      "samshanmukh",
      "zup",
      123,
    )).resolves.toBe(GITHUB_ACTIONS_BILLING_BLOCKED_MESSAGE);
  });

  it("preserves a generic failing annotation with retry guidance", async () => {
    const github = githubWithAnnotation("The selected runner image is unavailable.");

    await expect(githubRuntimeVerificationFailureMessage(
      github,
      "samshanmukh",
      "zup",
      123,
    )).resolves.toBe(
      "The selected runner image is unavailable. Review the GitHub run, correct the failure, then retry runtime verification.",
    );
  });

  it("returns null when GitHub exposes no diagnostic annotation", async () => {
    const github = {
      rest: {
        actions: {
          listJobsForWorkflowRun: vi.fn().mockResolvedValue({ data: { jobs: [] } }),
        },
      },
    } as unknown as Octokit;

    await expect(githubRuntimeVerificationFailureMessage(
      github,
      "samshanmukh",
      "zup",
      123,
    )).resolves.toBeNull();
  });
});
