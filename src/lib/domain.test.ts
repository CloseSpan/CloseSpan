import { describe, expect, it } from "vitest";
import { assertTenant, calculateImpact, type ImpactFactor } from "./domain";

describe("calculateImpact", () => {
  it("calculates a transparent weighted score", () => {
    const factors: ImpactFactor[] = [
      { key: "frequency", label: "Frequency", value: 80, weight: 75, evidence: "8 reports" },
      { key: "severity", label: "Severity", value: 20, weight: 25, evidence: "Minor workaround" },
    ];
    expect(calculateImpact(factors)).toEqual({ score: 65, explanation: "Frequency: 8 reports • Severity: Minor workaround" });
  });

  it("handles a disabled scoring policy", () => {
    expect(calculateImpact([{ key: "frequency", label: "Frequency", value: 80, weight: 0, evidence: "None" }])).toEqual({ score: 0, explanation: "No prioritization weights are enabled." });
  });

  it("rejects invalid and duplicate factors", () => {
    const invalid: ImpactFactor = { key: "frequency", label: "Frequency", value: 101, weight: 20, evidence: "Invalid" };
    expect(() => calculateImpact([invalid])).toThrow("between 0 and 100");
    const valid = { ...invalid, value: 50 };
    expect(() => calculateImpact([valid, valid])).toThrow("must be unique");
  });

  it("treats engineering effort as a cost", () => {
    const lowEffort: ImpactFactor = { key: "engineeringEffort", label: "Effort", value: 10, weight: 100, evidence: "Small change" };
    const highEffort = { ...lowEffort, value: 90 };
    expect(calculateImpact([lowEffort]).score).toBe(90);
    expect(calculateImpact([highEffort]).score).toBe(10);
  });
});

describe("tenant boundary", () => {
  it("rejects cross-organization access", () => expect(() => assertTenant("org_a", "org_b")).toThrow("Tenant boundary violation"));
  it("allows records in the requested organization", () => expect(() => assertTenant("org_a", "org_a")).not.toThrow());
});
