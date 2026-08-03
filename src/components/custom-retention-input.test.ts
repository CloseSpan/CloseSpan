import { describe, expect, it } from "vitest";
import {
  CUSTOM_RETENTION_OPTION,
  formatCustomRetention,
  initialRetentionSelection,
  isValidCustomRetention,
  parseCustomRetention,
} from "./custom-retention-input";

describe("custom retention input", () => {
  it.each(["1 day", "45 days", "18 months", "2 years", " 3 YEARS "])(
    "accepts %s",
    (value) => {
      expect(isValidCustomRetention(value)).toBe(true);
    },
  );

  it.each(["", "0 days", "days", "1.5 years", "12 weeks", "90"])(
    "rejects %s",
    (value) => {
      expect(isValidCustomRetention(value)).toBe(false);
    },
  );

  it("keeps standard policies in the preset selector", () => {
    expect(initialRetentionSelection(90)).toEqual({
      option: "90 days",
      customValue: "",
    });
    expect(initialRetentionSelection(365)).toEqual({
      option: "365 days",
      customValue: "",
    });
  });

  it("loads nonstandard database values into the custom field", () => {
    expect(initialRetentionSelection(180)).toEqual({
      option: CUSTOM_RETENTION_OPTION,
      customValue: "180 days",
    });
  });

  it("splits stored durations into numeric and unit controls", () => {
    expect(parseCustomRetention("18 months")).toEqual({
      quantity: "18",
      unit: "months",
    });
    expect(parseCustomRetention("1 year")).toEqual({
      quantity: "1",
      unit: "years",
    });
  });

  it("formats singular and plural durations for storage", () => {
    expect(formatCustomRetention("1", "days")).toBe("1 day");
    expect(formatCustomRetention("2", "years")).toBe("2 years");
    expect(formatCustomRetention("", "months")).toBe("");
  });
});
