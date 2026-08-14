import { describe, expect, it } from "vitest";
import {
  buildPddRequiredRevision,
  reconcilePddPromptRevision,
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

  it("extracts contract sections returned inline after recommendation text", () => {
    const changes = [
      'Update the prompt with the complete PDD "Context" contract section: ## Context A user has an existing caption before regeneration.',
      'Update the prompt with the complete PDD "Acceptance Criteria" contract section: ## Acceptance Criteria 1. Undo restores the previous caption.',
      'Update the prompt with the complete PDD "Oracle" contract section: ## Oracle The restored text exactly matches the original.',
      'Update the prompt with the complete PDD "Non-Oracle" contract section: ## Non-Oracle The storage mechanism does not determine success.',
      'Update the prompt with the complete PDD "Negative Cases" contract section: ## Negative Cases Undo must not clear the caption.',
      'Update the prompt with the complete PDD "Non-Goals" contract section: ## Non-Goals Multi-level undo is excluded.',
    ];

    const revision = buildPddRequiredRevision("Add caption regeneration undo.", changes);

    expect(revision).toContain("## Context\nA user has an existing caption");
    expect(revision).toContain("## Acceptance Criteria\n1. Undo restores");
    expect(revision).toContain("## Non-Goals\nMulti-level undo is excluded.");
    expect(revision).not.toContain("Update the prompt with the complete PDD");
  });

  it("treats an identical generated revision as already aligned", () => {
    const implementationPrompt = [
      "## Goal",
      "Add caption regeneration undo.",
      "",
      "## Context",
      "A caption exists before regeneration.",
      "",
      "## Acceptance Criteria",
      "Undo restores the previous caption.",
      "",
      "## Oracle",
      "The restored caption exactly matches the original.",
      "",
      "## Non-Oracle",
      "Storage details do not determine success.",
      "",
      "## Negative Cases",
      "Undo must not clear the caption.",
      "",
      "## Non-Goals",
      "Multi-level undo is excluded.",
    ].join("\n");
    const changes = [
      '## Context\nA caption exists before regeneration.',
      '## Acceptance Criteria\nUndo restores the previous caption.',
      '## Oracle\nThe restored caption exactly matches the original.',
      '## Non-Oracle\nStorage details do not determine success.',
      '## Negative Cases\nUndo must not clear the caption.',
      '## Non-Goals\nMulti-level undo is excluded.',
    ];

    expect(reconcilePddPromptRevision({
      implementationPrompt,
      verdict: "Needs revision",
      changes,
    })).toEqual({ verdict: "Passed", changes: [], suggestedRevision: null });
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
