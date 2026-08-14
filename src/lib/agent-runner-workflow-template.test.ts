import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), "templates/tenki-github-actions/closespan-agent-runner.yml"),
  "utf8",
);

describe("approval-bound agent runner workflow template", () => {
  it("gives the coding agent explicit immutable-test and implementation constraints", () => {
    expect(workflow).toContain("Change at least one implementation file outside the generated Prompt Testing acceptance tests.");
    expect(workflow).toContain("Never edit, replace, delete, weaken, or regenerate any protected acceptance test");
    expect(workflow).toContain("prompt-file=${agentPromptPath}");
  });

  it("does not count generated acceptance tests as product implementation", () => {
    expect(workflow).toContain("const implementationPaths = paths.filter(file => !generatedTestPaths.has(file));");
    expect(workflow).toContain("No product implementation file changed; generated acceptance tests cannot be used as the implementation.");
  });

  it("accepts a newer patch release within the approved Xcode major version", () => {
    expect(workflow).toContain("actual[0] === required[0]");
    expect(workflow).toContain("is not compatible with approved Xcode");
    expect(workflow).not.toContain("includes(`Xcode ${mobile.xcode.version}`)");
  });

  it("starts independent verification only for a guarded successful report", () => {
    expect(workflow).toContain("verification-ready: ${{ steps.report.outputs.verification-ready }}");
    expect(workflow).toContain("needs.implementation.outputs.verification-ready == 'true'");
  });
});
