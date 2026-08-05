import { describe, expect, it } from "vitest";
import {
  isUnresolvedRepositoryLabel,
  resolveProblemRepository,
} from "./problem-repository-match";

const evidence = {
  suspectedRepository: "Not yet identified",
  suspectedFiles: ["services/billing/src/invoices.ts"],
  title: "Billing invoice export fails",
  statement: "Invoices cannot be exported from billing.",
  summary: "Billing teams need reliable invoice exports.",
  productArea: "Billing",
  team: "Revenue systems",
};

describe("problem-to-repository matching", () => {
  it("treats the existing placeholder as unresolved", () => {
    expect(isUnresolvedRepositoryLabel("Not yet identified")).toBe(true);
    expect(isUnresolvedRepositoryLabel("Acme/billing-service")).toBe(false);
  });

  it("accepts an exact authorized repository without heuristics", () => {
    const result = resolveProblemRepository(
      { ...evidence, suspectedRepository: "Acme/Billing-Service" },
      [
        { repository: "acme/web", defaultBranch: "main" },
        { repository: "acme/billing-service", defaultBranch: "trunk" },
      ],
    );
    expect(result.selected).toMatchObject({
      repository: "acme/billing-service",
      defaultBranch: "trunk",
      confidence: 1,
    });
    expect(result.needsReview).toBe(false);
  });

  it("selects the only active authorized repository", () => {
    const result = resolveProblemRepository(evidence, [
      { repository: "acme/platform", defaultBranch: "main" },
    ]);
    expect(result.selected?.repository).toBe("acme/platform");
    expect(result.selected?.confidence).toBe(0.95);
  });

  it("uses file, ownership, and problem evidence for a clear multi-repository match", () => {
    const result = resolveProblemRepository(evidence, [
      { repository: "acme/mobile-experience", defaultBranch: "main" },
      {
        repository: "acme/billing",
        defaultBranch: "main",
        workspaceRoots: ["services/billing"],
        manifestSignals: ["invoice export revenue"],
      },
    ]);
    expect(result.selected?.repository).toBe("acme/billing");
    expect(result.needsReview).toBe(false);
    expect(result.selected?.reasons.length).toBeGreaterThan(1);
  });

  it("does not silently select an ambiguous repository", () => {
    const ambiguous = {
      ...evidence,
      suspectedFiles: [],
      title: "Export fails",
      statement: "An export cannot complete.",
      summary: "A customer cannot export data.",
      productArea: "Reporting",
      team: "Platform",
    };
    const result = resolveProblemRepository(ambiguous, [
      { repository: "acme/export-api", defaultBranch: "main" },
      { repository: "acme/export-worker", defaultBranch: "main" },
    ]);
    expect(result.selected).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.ranked).toHaveLength(2);
  });

  it("stays unresolved when the workspace has no authorized repository", () => {
    const result = resolveProblemRepository(evidence, []);
    expect(result.selected).toBeNull();
    expect(result.reason).toMatch(/No active GitHub repository/);
  });
});
