import { describe, expect, it } from "vitest";
import {
  hashImplementationPrompt,
  promptArtifactPath,
  renderImplementationPrompt,
  ticketReadiness,
  validateEngineeringTicket,
  type EngineeringTicketSpecification,
  type ImplementationPromptSnapshot,
} from "./engineering-prompt";
import { evaluateUserStoryPromptMatch } from "./user-story-prompt-test";

const ticket: EngineeringTicketSpecification = {
  userStory: "As an analyst, I want large exports to contain rows so that I can complete customer reporting.",
  currentBehavior: "Large exports finish with an empty file.",
  expectedBehavior: "Large exports contain every selected row.",
  reproductionSteps: ["Export a dataset with more than 10,000 rows."],
  businessOutcome: "Enterprise analysts can complete scheduled reporting.",
  acceptanceCriteria: [{ id: "AC-1", statement: "A 10,001-row export contains 10,001 data rows.", measurable: true }],
  testScenarios: [{ id: "TEST-1", title: "Large export", given: "A dataset with 10,001 rows", when: "The user exports CSV", then: "The CSV contains all rows", testLevel: "integration", criterionIds: ["AC-1"] }],
  regressionScenarios: ["Small exports remain unchanged."],
  negativeScenarios: ["A failed object-store write does not report completion."],
  qualityExpectations: ["Do not log customer row contents."],
  requiredTestLevels: ["integration"],
  releaseVerification: "Export a production-safe synthetic 10,001-row dataset after deployment.",
  nonGoals: ["Changing export formats."],
  permittedPaths: ["src/export/**", "tests/export/**"],
  requiredCommands: ["npm test -- export"],
  repository: "northstar/analytics-api",
  baseBranch: "main",
  baseSha: "a".repeat(40),
};

const snapshot: ImplementationPromptSnapshot = {
  schemaVersion: 1,
  ticket,
  evidence: {
    problemId: "CS-142",
    title: "Large exports produce empty files",
    statement: "Exports above the threshold complete before storage commits.",
    summary: "Three redacted reports reproduce the same release-linked behavior.",
    severity: "High",
    productArea: "Exports",
    team: "Data Platform",
    assumptions: [],
    missingInformation: ["Production trace"],
    suspectedFiles: ["src/export/finalize.ts"],
    redactedEvidence: [],
  },
};

describe("engineering prompt contract", () => {
  it("validates a measurable user story with complete test coverage", () => {
    expect(validateEngineeringTicket(ticket)).toEqual(ticket);
    expect(ticketReadiness(ticket)).toEqual({ ready: true, issues: [] });
  });

  it("rejects unmapped acceptance criteria and manual claims outside required levels", () => {
    const invalid = structuredClone(ticket);
    invalid.acceptanceCriteria.push({ id: "AC-2", statement: "Failures remain visible to users.", measurable: true });
    expect(ticketReadiness(invalid).ready).toBe(false);
    expect(ticketReadiness(invalid).issues).toContain("AC-2 is not covered by a test scenario");
  });

  it("renders and hashes prompts deterministically", () => {
    const artifactPath = promptArtifactPath(snapshot.evidence.problemId, snapshot.evidence.title);
    const first = renderImplementationPrompt(snapshot, { promptRevision: 1, artifactPath });
    const second = renderImplementationPrompt(structuredClone(snapshot), { promptRevision: 1, artifactPath });
    expect(first).toBe(second);
    expect(hashImplementationPrompt(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashImplementationPrompt(first)).toBe(hashImplementationPrompt(second));
    expect(first).toContain("**AC-1**");
    expect(first).toContain("### TEST-1: Large export");
  });

  it("tests only the prompt user-story section", () => {
    const artifactPath = promptArtifactPath(snapshot.evidence.problemId, snapshot.evidence.title);
    const prompt = renderImplementationPrompt(snapshot, { promptRevision: 1, artifactPath });
    expect(evaluateUserStoryPromptMatch("   ", prompt)).toMatchObject({ status: "empty", matches: false });
    expect(evaluateUserStoryPromptMatch("Users need exports to work", prompt)).toMatchObject({ status: "malformed", matches: false });
    expect(evaluateUserStoryPromptMatch("As a   I want   so that  .", prompt)).toMatchObject({ status: "malformed", matches: false });
    expect(evaluateUserStoryPromptMatch(ticket.userStory, prompt)).toMatchObject({ status: "match", matches: true });

    const differentStory = "As an analyst, I want small exports to finish so that I can preview reports.";
    expect(evaluateUserStoryPromptMatch(differentStory, `${prompt}\n${differentStory}`)).toMatchObject({
      status: "mismatch",
      matches: false,
    });
    expect(evaluateUserStoryPromptMatch(ticket.userStory, "# Prompt without the required section")).toMatchObject({
      status: "prompt-section-missing",
      matches: false,
    });
    expect(evaluateUserStoryPromptMatch(ticket.userStory, prompt.replace("## Problem and outcome", "## User story\nDecoy\n\n## Problem and outcome"))).toMatchObject({
      status: "prompt-section-missing",
      matches: false,
    });
    const compatibilityVariant = ticket.userStory.replace("analyst", "ａｎａｌｙｓｔ");
    expect(evaluateUserStoryPromptMatch(compatibilityVariant, prompt)).toMatchObject({
      status: "mismatch",
      matches: false,
    });
  });
});
