import { describe, expect, it } from "vitest";
import {
  buildPddRequiredRevision,
  pddPromptReviewSchema,
} from "./pdd-prompt-review";

describe("Prompt Testing prompt review contract", () => {
  it("accepts a compact actionable Prompt Testing result without an invented score", () => {
    const result = pddPromptReviewSchema.parse({
      verdict: "Needs revision",
      summary: "Prompt Testing found 1 change to make before approval.",
      changes: ["Require the downloaded CSV to contain every expected row."],
      suggestedRevision: "Ensure large exports contain every expected row.",
      pddVersion: "0.0.309",
      executionMode: "cloud",
      model: "gpt-5.6-sol",
      costUsd: 0.02,
      promptHash: "a".repeat(64),
      alignmentReceipt: null,
      revisionReceipt: "signed.receipt",
    });
    expect(result.verdict).toBe("Needs revision");
    expect(result).not.toHaveProperty("score");
  });

  it("preserves a complete generated contract recommendation", () => {
    const contractRecommendation = [
      'Update the prompt with the complete Prompt Testing "Acceptance Criteria" contract section:',
      "",
      "## Acceptance Criteria",
      "- Given valid names, when the workflow is submitted, then every name is present in the payload.",
      "- Given no Post Context, when the workflow is submitted, then existing behavior is unchanged.",
    ].join("\n");
    const result = pddPromptReviewSchema.parse({
      verdict: "Needs revision",
      summary: "Prompt Testing found 1 change to make before approval.",
      changes: [contractRecommendation],
      suggestedRevision: "Apply the complete acceptance contract.",
      pddVersion: "0.0.309",
      executionMode: "cloud",
      model: "gpt-5.6-sol",
      costUsd: 0.02,
      promptHash: "b".repeat(64),
      alignmentReceipt: null,
      revisionReceipt: "signed.receipt",
    });
    expect(result.changes[0]).toBe(contractRecommendation);
  });

  it("embeds generated contract sections as real prompt headings", () => {
    const revision = buildPddRequiredRevision("Fix the workflow.", [
      [
        'Update the prompt with the complete Prompt Testing "Context" contract section:',
        "",
        "## Context",
        "The workflow must apply the submitted Post Context.",
      ].join("\n"),
      [
        'Update the prompt with the complete Prompt Testing "Negative Cases" contract section:',
        "",
        "## Negative Cases",
        "- Post Context must not be silently ignored.",
      ].join("\n"),
    ]);

    expect(revision).toContain("Fix the workflow.\n\n## PDD-required outcomes");
    expect(revision).toContain("\n\n## Context\nThe workflow must apply");
    expect(revision).toContain("\n\n## Negative Cases\n- Post Context must not");
    expect(revision).not.toContain("Update the prompt with the complete Prompt Testing");
  });

  it("canonicalizes Prompt Testing's contract-first rewrite without duplicate criteria", () => {
    const prompt = [
      "Correct the affected workflow and preserve unrelated behavior.",
      "",
      "Acceptance criteria:",
      "1. A duplicated free-form criterion.",
      "",
      "## PDD-required outcomes",
      "",
      "## Context",
      "Post Context must affect the workflow result.",
      "",
      "## Acceptance Criteria",
      "1. Given Post Context, when the workflow runs, then the result reflects it.",
      "",
      "## Oracle",
      "- The result visibly reflects Post Context.",
      "",
      "## Non-Oracle",
      "- Internal implementation does not determine success.",
      "",
      "## Negative Cases",
      "- Post Context must not be ignored.",
      "",
      "## Non-Goals",
      "- Unrelated workflow redesign is excluded.",
    ].join("\n");

    const revision = buildPddRequiredRevision(prompt, [
      "Apply a contract-first rewrite without duplicated or expanded requirements.",
    ]);

    expect(revision.startsWith("## Goal\nCorrect the affected workflow")).toBe(true);
    expect(revision).not.toContain("Acceptance criteria:\n");
    expect(revision).not.toContain("## PDD-required outcomes");
    expect(revision.match(/^## Acceptance Criteria$/gm)).toHaveLength(1);
    expect(revision.match(/^## Context$/gm)).toHaveLength(1);
    expect(revision.match(/^## Non-Goals$/gm)).toHaveLength(1);
  });

  it("replaces an existing contract when Prompt Testing regenerates all six sections", () => {
    const headings = [
      "Context",
      "Acceptance Criteria",
      "Oracle",
      "Non-Oracle",
      "Negative Cases",
      "Non-Goals",
    ];
    const changes = headings.map((heading) => [
      `Update the prompt with the complete Prompt Testing "${heading}" contract section:`,
      "",
      `## ${heading}`,
      `Canonical ${heading} requirement.`,
    ].join("\n"));
    const revision = buildPddRequiredRevision([
      "## Goal",
      "Correct the affected workflow.",
      "",
      "## Context",
      "Stale context.",
      "",
      "## Acceptance Criteria",
      "Stale acceptance criteria.",
      "",
      "## Oracle",
      "Stale oracle.",
      "",
      "## Non-Oracle",
      "Stale non-oracle.",
      "",
      "## Negative Cases",
      "Stale negative cases.",
      "",
      "## Non-Goals",
      "Stale non-goals.",
    ].join("\n"), changes);

    expect(revision.match(/^## Context$/gm)).toHaveLength(1);
    expect(revision.match(/^## Acceptance Criteria$/gm)).toHaveLength(1);
    expect(revision).toContain("Canonical Acceptance Criteria requirement.");
    expect(revision).not.toContain("Stale acceptance criteria.");
    expect(revision).not.toContain("## PDD-required outcomes");
  });

  it("preserves repository and runtime evidence when Prompt Testing regenerates the contract", () => {
    const implementationPrompt = [
      "# CloseSpan implementation ticket",
      "",
      "## Repository context",
      "Pinned repository: samshanmukh/zup@abc123",
      "",
      "## Current issue runtime evidence",
      "Outcome: Confirmed current",
      "",
      "## Agent boundaries and definition of done",
      "- Stop after producing a reviewable branch.",
    ].join("\n");
    const changes = [
      "Context",
      "Acceptance Criteria",
      "Oracle",
      "Non-Oracle",
      "Negative Cases",
      "Non-Goals",
    ].map((heading) => [
      `Update the prompt with the complete Prompt Testing "${heading}" contract section:`,
      "",
      `## ${heading}`,
      `Canonical ${heading} requirement.`,
    ].join("\n"));

    const revision = buildPddRequiredRevision(implementationPrompt, changes);

    expect(revision).toContain("## Repository context");
    expect(revision).toContain("samshanmukh/zup@abc123");
    expect(revision).toContain("## Current issue runtime evidence");
    expect(revision).toContain("## Agent boundaries and definition of done");
    expect(revision).toContain("## PDD-required outcomes");
    expect(revision.match(/^## Acceptance Criteria$/gm)).toHaveLength(1);
  });
});
