import { z } from "zod";

export const pddPromptReviewSchema = z.object({
  verdict: z.enum(["Passed", "Needs revision"]),
  summary: z.string().trim().min(1).max(300),
  changes: z.array(z.string().trim().min(1).max(16_000)).max(8),
  acceptanceContract: z.string().trim().min(1).max(1_000_000).optional(),
  suggestedRevision: z.string().trim().min(1).max(64_000).nullable(),
  pddVersion: z.string().trim().min(1).max(64),
  executionMode: z.enum(["cloud", "local"]),
  model: z.string().trim().min(1).max(200).nullable(),
  costUsd: z.number().min(0).max(5).nullable(),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  alignmentReceipt: z.string().max(4_096).nullable(),
  revisionReceipt: z.string().max(4_096).nullable(),
});

export type PddPromptReview = z.infer<typeof pddPromptReviewSchema>;

export interface ReconciledPddPromptRevision {
  verdict: "Passed" | "Needs revision";
  changes: string[];
  suggestedRevision: string | null;
}

const PDD_CONTRACT_HEADINGS = [
  "Context",
  "Acceptance Criteria",
  "Oracle",
  "Non-Oracle",
  "Negative Cases",
  "Non-Goals",
] as const;

function existingContractBlocks(implementationPrompt: string): string[] | null {
  const blocks = PDD_CONTRACT_HEADINGS.map((heading) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return implementationPrompt.match(
      new RegExp(`^## ${escaped}\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, "m"),
    )?.[0]?.trim() ?? null;
  });
  return blocks.every((block): block is string => Boolean(block)) ? blocks : null;
}

function revisionGoal(implementationPrompt: string): string | null {
  return implementationPrompt
    .replace(/^## Goal\n/i, "")
    .split(/^(?:Acceptance criteria:|## PDD-required outcomes|## Context)$/im, 1)[0]
    ?.trim() || null;
}

function isCloseSpanImplementationTicket(implementationPrompt: string): boolean {
  return implementationPrompt.includes("# CloseSpan implementation ticket")
    || implementationPrompt.includes("## Repository context")
    || implementationPrompt.includes("## Current issue runtime evidence");
}

function withoutExistingPddOutcomes(implementationPrompt: string): string {
  return implementationPrompt.split(/^## PDD-required outcomes$/m, 1)[0]?.trim()
    ?? implementationPrompt.trim();
}

export function buildPddRequiredRevision(
  implementationPrompt: string,
  changes: readonly string[],
): string {
  const generatedBlocks = changes.map((change) => {
    const contractHeading = PDD_CONTRACT_HEADINGS.find((heading) =>
      change.includes(`## ${heading}`),
    );
    if (contractHeading) {
      const marker = `## ${contractHeading}`;
      const markerIndex = change.indexOf(marker);
      const body = change.slice(markerIndex + marker.length).trim();
      return body ? `${marker}\n${body}` : marker;
    }
    const heading = change.match(/(?:^|\n)(## [^\n]+\n[\s\S]*)$/);
    return heading?.[1]?.trim() ?? null;
  });
  const completeGeneratedContract = PDD_CONTRACT_HEADINGS.map((heading) =>
    generatedBlocks.find((block) => block?.startsWith(`## ${heading}\n`)) ?? null,
  );
  if (completeGeneratedContract.every((block): block is string => Boolean(block))) {
    if (isCloseSpanImplementationTicket(implementationPrompt)) {
      return [
        withoutExistingPddOutcomes(implementationPrompt),
        "## PDD-required outcomes",
        ...completeGeneratedContract,
      ].join("\n\n");
    }
    const goal = revisionGoal(implementationPrompt);
    if (goal) return [`## Goal\n${goal}`, ...completeGeneratedContract].join("\n\n");
  }
  if (changes.some((change) => /contract-first rewrite/i.test(change))) {
    const existingBlocks = existingContractBlocks(implementationPrompt);
    if (existingBlocks) {
      if (isCloseSpanImplementationTicket(implementationPrompt)) {
        return [
          withoutExistingPddOutcomes(implementationPrompt),
          "## PDD-required outcomes",
          ...existingBlocks,
        ].join("\n\n");
      }
      const goal = revisionGoal(implementationPrompt);
      if (goal) {
        return [`## Goal\n${goal}`, ...existingBlocks].join("\n\n");
      }
    }
  }
  const contractBlocks = generatedBlocks.map((block, index) =>
    block ?? `- ${changes[index]?.trim()}`,
  );
  return [
    implementationPrompt.trim(),
    "## PDD-required outcomes",
    ...contractBlocks,
  ].join("\n\n");
}

export function reconcilePddPromptRevision(input: {
  implementationPrompt: string;
  verdict: "Passed" | "Needs revision";
  changes: readonly string[];
}): ReconciledPddPromptRevision {
  if (input.verdict === "Passed") {
    return { verdict: "Passed", changes: [], suggestedRevision: null };
  }
  const suggestedRevision = buildPddRequiredRevision(
    input.implementationPrompt,
    input.changes,
  );
  if (suggestedRevision.trim() === input.implementationPrompt.trim()) {
    return { verdict: "Passed", changes: [], suggestedRevision: null };
  }
  return {
    verdict: "Needs revision",
    changes: [...input.changes],
    suggestedRevision,
  };
}
