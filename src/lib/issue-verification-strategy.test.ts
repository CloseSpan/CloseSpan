import { describe, expect, it } from "vitest";
import { buildIssueVerificationPrompt } from "./issue-runtime-verification";

const prompt = buildIssueVerificationPrompt({
  runId: "11111111-1111-4111-8111-111111111111",
  baseSha: "a".repeat(40),
  repository: "acme/mobile-app",
  workspaceRoot: "AppNative",
  problem: {
    title: "Add more actions to the three-dot menu",
    statement: "The three-dot menu currently duplicates the Edit action.",
    summary: "A customer requested additional menu actions.",
    investigation_id: "inv-1",
    hypothesis: "The overflow action and Edit button share the same route.",
    assumptions: ["Both controls use the same view model."],
    missing_information: ["Confirm the current menu wiring."],
    recommended_tests: ["Inspect the menu action handler."],
    suspected_files: ["AppNative/MenuView.swift"],
  },
  repositoryEvidence: "MenuView.swift wires both controls to openEditor().",
});

describe("issue verification evidence strategy", () => {
  it("starts with repository analysis and accepts decisive code evidence", () => {
    expect(prompt).toContain("Start with targeted repository analysis at the exact pinned commit");
    expect(prompt).toContain("Repository analysis is sufficient");
    expect(prompt).toContain("finish without launching a product runtime");
  });

  it("escalates only behavior that genuinely requires a runtime", () => {
    expect(prompt).toContain("Escalate to Runtime execution only when");
    expect(prompt).toContain("rendering, layout, gesture handling, timing, animation");
    expect(prompt).toContain("A UI report does not automatically require a UI test");
  });

  it("handles feature requests as current capability checks", () => {
    expect(prompt).toContain("verify the current product baseline or capability gap");
    expect(prompt).toContain("Do not try to reproduce a feature that has not been implemented yet");
  });

  it("uses the runner-owned canonical report and artifact paths", () => {
    expect(prompt).toContain("exact path in CLOSESPAN_RUNTIME_REPORT_PATH");
    expect(prompt).toContain("CLOSESPAN_RUNTIME_ARTIFACT_DIR");
    expect(prompt).toContain("verificationMethod, runtimeRequiredReason");
  });
});
