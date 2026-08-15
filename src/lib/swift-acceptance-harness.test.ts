import { describe, expect, it } from "vitest";
import {
  CLOSESPAN_SWIFT_ACCEPTANCE_TEST_COMMAND,
  normalizeSwiftAcceptanceHarnessCommand,
} from "./swift-acceptance-harness";

describe("standalone Swift acceptance harness", () => {
  it("upgrades the legacy interpreter command for already-saved tickets", () => {
    expect(normalizeSwiftAcceptanceHarnessCommand(
      "swift tests/CloseSpanPDDTests.swift",
    )).toBe(CLOSESPAN_SWIFT_ACCEPTANCE_TEST_COMMAND);
  });

  it("does not broaden or rewrite unrelated approved commands", () => {
    expect(normalizeSwiftAcceptanceHarnessCommand("swift test"))
      .toBe("swift test");
  });
});
