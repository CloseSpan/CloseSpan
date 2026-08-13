import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), "templates/tenki-github-actions/closespan-runtime-verifier.yml"),
  "utf8",
);

describe("current-issue runtime verifier workflow template", () => {
  it("boots and exports a reusable iOS Simulator harness before verification", () => {
    expect(workflow).toContain("name: Prepare iOS Simulator harness");
    expect(workflow).toContain("xcrun simctl bootstatus");
    expect(workflow).toContain("CLOSESPAN_IOS_SIMULATOR_UDID");
    expect(workflow).toContain(".closespan-run/bin/ios-simulator");
    expect(workflow).toContain('sips --resampleHeightWidthMax 960 "$output"');
  });

  it("allows CoreSimulator access only for the macOS verifier job", () => {
    expect(workflow).toContain("sandbox: ${{ runner.os == 'macOS' && 'danger-full-access' || 'workspace-write' }}");
    expect(workflow).toContain("safety-strategy: drop-sudo");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
  });

  it("reports bootstrap failures even when no verification artifact directory exists", () => {
    expect(workflow).toContain("needs: [bootstrap, verify]");
    expect(workflow).toContain("mkdir -p .closespan-run");
    expect(workflow).toContain("The verifier could not fetch its approval-bound CloseSpan job.");
  });
});
