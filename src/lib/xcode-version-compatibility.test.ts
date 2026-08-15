import { describe, expect, it } from "vitest";
import {
  compatibleXcodeMajor,
  xcodeMajorCompatibilityCommand,
} from "./xcode-version-compatibility";

describe("Xcode version compatibility", () => {
  it("accepts releases on the same major line", () => {
    expect(compatibleXcodeMajor("26", "26.1")).toBe(true);
    expect(compatibleXcodeMajor("26.2", "26.1")).toBe(true);
  });

  it("rejects a genuinely incompatible major version", () => {
    expect(compatibleXcodeMajor("16.4", "26.1")).toBe(false);
  });

  it("builds a runner preflight that validates the major and reports the actual version", () => {
    const command = xcodeMajorCompatibilityCommand("26.1");
    expect(command).toContain('${actual%%.*}');
    expect(command).toContain('= "26"');
    expect(command).toContain("Validated Xcode %s for approved Xcode 26.1");
  });
});
