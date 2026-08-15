import { describe, expect, it } from "vitest";
import type { ImplementationPromptSnapshot } from "./engineering-prompt";
import {
  PDD_CLI_VERSION,
  renderPddPrompt,
  sha256,
  validateGeneratedTests,
} from "./pdd-verification";

const snapshot: ImplementationPromptSnapshot = {
  schemaVersion: 1,
  ticket: {
    userStory: "As an analyst, I want complete exports, so that reports are accurate.",
    currentBehavior: "Large exports can be empty.",
    expectedBehavior: "Large exports contain every selected row.",
    reproductionSteps: ["Export a large dataset."],
    businessOutcome: "Reports stay accurate.",
    acceptanceCriteria: [{ id: "AC-1", statement: "Every selected row is exported.", measurable: true }],
    testScenarios: [{ id: "TEST-1", title: "Large export", given: "many rows", when: "exported", then: "all rows are present", testLevel: "unit", criterionIds: ["AC-1"] }],
    regressionScenarios: ["Small exports still work."],
    negativeScenarios: ["A failed write is not marked complete."],
    qualityExpectations: [], requiredTestLevels: ["unit"],
    releaseVerification: "Run an export.", nonGoals: [],
    permittedPaths: ["src/**", "tests/**"], requiredCommands: ["npm test"],
    repository: "close/span", baseBranch: "main", baseSha: "a".repeat(40),
  },
  evidence: {
    problemId: "problem-1", title: "Empty exports", statement: "", summary: "",
    severity: "High", productArea: "Exports", team: "Core", assumptions: [],
    missingInformation: [], suspectedFiles: ["src/export.ts"], redactedEvidence: [],
  },
};

describe("Prompt Testing acceptance verification", () => {
  it("renders the PM story and measurable contract for Prompt Testing", () => {
    const prompt = renderPddPrompt(snapshot.ticket.userStory, snapshot);
    expect(prompt).toContain("## Product-manager user story");
    expect(prompt).toContain("AC-1: Every selected row is exported.");
    expect(prompt).toContain("Do not implement the solution.");
  });

  it("accepts only hash-valid tests in approved paths and commands", () => {
    const content = "describe('export', () => { it('keeps rows', () => {}) })";
    const result = validateGeneratedTests({
      schemaVersion: 1,
      verificationId: "11111111-1111-4111-8111-111111111111",
      promptHash: "b".repeat(64),
      status: "Ready for approval",
      pddVersion: PDD_CLI_VERSION,
      model: "openai/test",
      costUsd: 0.01,
      summary: "Generated one acceptance test.",
      generatedTests: [{ path: "tests/export.pdd.test.ts", content, contentHash: sha256(content), command: "npm test" }],
      failureMessage: null,
    }, snapshot);
    expect(result.generatedTests[0]?.contentHash).toBe(sha256(content));
  });

  it("rejects an unapproved validation command", () => {
    const content = "test('unsafe', () => {})";
    expect(() => validateGeneratedTests({
      schemaVersion: 1,
      verificationId: "11111111-1111-4111-8111-111111111111",
      promptHash: "b".repeat(64), status: "Ready for approval",
      pddVersion: PDD_CLI_VERSION, model: null, costUsd: null,
      summary: "Generated.",
      generatedTests: [{ path: "tests/export.pdd.test.ts", content, contentHash: sha256(content), command: "curl example.com" }],
      failureMessage: null,
    }, snapshot)).toThrow("was not approved");
  });

  it("requires non-unit user-story tests to target the VM-local running app", () => {
    const liveSnapshot: ImplementationPromptSnapshot = {
      ...snapshot,
      ticket: {
        ...snapshot.ticket,
        testScenarios: snapshot.ticket.testScenarios.map((scenario) => ({
          ...scenario,
          testLevel: "end-to-end" as const,
        })),
        requiredTestLevels: ["end-to-end"],
      },
    };
    const noOp = "test('claims to be live', () => {})";
    expect(() => validateGeneratedTests({
      schemaVersion: 1,
      verificationId: "11111111-1111-4111-8111-111111111111",
      promptHash: "b".repeat(64),
      status: "Ready for approval",
      pddVersion: PDD_CLI_VERSION,
      model: null,
      costUsd: null,
      summary: "Generated.",
      generatedTests: [{
        path: "tests/export.pdd.test.ts",
        content: noOp,
        contentHash: sha256(noOp),
        command: "npm test",
      }],
      failureMessage: null,
    }, liveSnapshot)).toThrow("CLOSESPAN_APP_URL");

    const live = "test('uses the app', async () => { await fetch(process.env.CLOSESPAN_APP_URL + '/exports') })";
    expect(validateGeneratedTests({
      schemaVersion: 1,
      verificationId: "11111111-1111-4111-8111-111111111111",
      promptHash: "b".repeat(64),
      status: "Ready for approval",
      pddVersion: PDD_CLI_VERSION,
      model: null,
      costUsd: null,
      summary: "Generated.",
      generatedTests: [{
        path: "tests/export.pdd.test.ts",
        content: live,
        contentHash: sha256(live),
        command: "npm test",
      }],
      failureMessage: null,
    }, liveSnapshot).generatedTests[0]?.content).toContain("CLOSESPAN_APP_URL");
  });

  it("accepts native runtime harnesses without a web-only base URL", () => {
    const nativeSnapshot: ImplementationPromptSnapshot = {
      ...snapshot,
      ticket: {
        ...snapshot.ticket,
        testScenarios: snapshot.ticket.testScenarios.map((scenario) => ({
          ...scenario,
          testLevel: "component" as const,
        })),
        requiredTestLevels: ["component"],
        permittedPaths: ["ZupNative/tests/**"],
        requiredCommands: [
          "swiftc -parse-as-library tests/CloseSpanPDDTests.swift -o /tmp/closespan-pdd-tests && /tmp/closespan-pdd-tests",
        ],
      },
    };
    const content = [
      "import Foundation",
      "@main",
      "struct CloseSpanPDDTests {",
      "  static func main() { print(\"native acceptance harness\") }",
      "}",
    ].join("\n");

    const result = validateGeneratedTests({
      schemaVersion: 1,
      verificationId: "11111111-1111-4111-8111-111111111111",
      promptHash: "b".repeat(64),
      status: "Ready for approval",
      pddVersion: PDD_CLI_VERSION,
      model: "openai/test",
      costUsd: 0.01,
      summary: "Generated a native acceptance harness.",
      generatedTests: [{
        path: "ZupNative/tests/CloseSpanPDDTests.swift",
        content,
        contentHash: sha256(content),
        command: "swiftc -parse-as-library tests/CloseSpanPDDTests.swift -o /tmp/closespan-pdd-tests && /tmp/closespan-pdd-tests",
      }],
      failureMessage: null,
    }, nativeSnapshot);

    expect(result.generatedTests[0]?.path).toBe(
      "ZupNative/tests/CloseSpanPDDTests.swift",
    );
  });
});
