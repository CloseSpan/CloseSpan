import { describe, expect, it } from "vitest";
import type { OverviewAnalytics } from "./overview-analytics";
import {
  classifyProblemTableTrend,
  countActiveProblemTableFilterColumns,
  countActiveProblemTableFilters,
  countActiveProblemTableFiltersByColumn,
  countActiveProblemTableFiltersForColumn,
  createEmptyProblemTableFilters,
  filterProblems,
  type ProblemTableFilters,
} from "./problem-table-filters";

const problems: OverviewAnalytics["problems"] = [
  {
    id: "p-rising",
    title: "Export reliability issue",
    severity: "High",
    stage: "Detected",
    type: "Bug",
    productArea: "Exports",
    currentSignals: 10,
    previousSignals: 5,
    membershipScores: [0.94],
    accounts: [],
    count: 10,
    revenue: 250_000,
    confidence: 94,
    trend: 100,
  },
  {
    id: "p-new",
    title: "Missing audit logs",
    severity: "Critical",
    stage: "Needs review",
    type: "Feature request",
    productArea: "Security",
    currentSignals: 5,
    previousSignals: 0,
    membershipScores: [0.8],
    accounts: [],
    count: 5,
    revenue: 100_000,
    confidence: 80,
    trend: null,
  },
  {
    id: "p-flat",
    title: "EXPORT history is hard to scan",
    severity: "Medium",
    stage: "In progress",
    type: "Usability",
    productArea: "Exports",
    currentSignals: 3,
    previousSignals: 3,
    membershipScores: [0.72],
    accounts: [],
    count: 3,
    revenue: 50_000,
    confidence: 72,
    trend: 0,
  },
  {
    id: "p-falling",
    title: "Slow dashboard loading",
    severity: "Low",
    stage: "Detected",
    type: "Bug",
    productArea: "Analytics",
    currentSignals: 2,
    previousSignals: 4,
    membershipScores: [0.65],
    accounts: [],
    count: 2,
    revenue: 25_000,
    confidence: 65,
    trend: -50,
  },
];

function filters(
  overrides: Partial<ProblemTableFilters> = {},
): ProblemTableFilters {
  return { ...createEmptyProblemTableFilters(), ...overrides };
}

describe("problem table filters", () => {
  it("creates fresh, deeply frozen empty filters", () => {
    const first = createEmptyProblemTableFilters();
    const second = createEmptyProblemTableFilters();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.severities).not.toBe(second.severities);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.severities)).toBe(true);
    expect(Object.isFrozen(first.trends)).toBe(true);
    expect(Object.isFrozen(first.stages)).toBe(true);
  });

  it("matches title substrings case-insensitively and preserves input order", () => {
    const sourceOrder = problems.map((problem) => problem.id);
    const result = filterProblems(problems, filters({ title: "  ExPoRt " }));

    expect(result.map((problem) => problem.id)).toEqual([
      "p-rising",
      "p-flat",
    ]);
    expect(problems.map((problem) => problem.id)).toEqual(sourceOrder);
  });

  it("uses inclusive numeric bounds and converts revenue from $k to dollars", () => {
    expect(
      filterProblems(
        problems,
        filters({
          signalsMin: "3",
          signalsMax: "10",
          revenueMin: "50",
          revenueMax: "250",
          confidenceMin: "72",
          confidenceMax: "94",
        }),
      ).map((problem) => problem.id),
    ).toEqual(["p-rising", "p-new", "p-flat"]);
  });

  it("ignores blank and invalid numeric values", () => {
    expect(
      filterProblems(
        problems,
        filters({
          signalsMin: "-1",
          signalsMax: "many",
          revenueMin: -10,
          revenueMax: "Infinity",
          confidenceMin: 101,
          confidenceMax: -1,
        }),
      ),
    ).toEqual(problems);

    expect(
      countActiveProblemTableFilters(
        filters({
          signalsMin: "-1",
          revenueMin: -10,
          confidenceMin: 101,
        }),
      ),
    ).toBe(0);
  });

  it("classifies and filters new, rising, flat, and falling trends", () => {
    expect(problems.map((problem) => classifyProblemTableTrend(problem.trend)))
      .toEqual(["rising", "new", "flat", "falling"]);
    expect(
      filterProblems(
        problems,
        filters({ trends: ["new", "falling"] }),
      ).map((problem) => problem.id),
    ).toEqual(["p-new", "p-falling"]);
  });

  it("uses OR within multi-select columns and AND across columns", () => {
    const result = filterProblems(
      problems,
      filters({
        severities: ["High", "Critical"],
        trends: ["new", "rising"],
        stages: ["Detected"],
      }),
    );

    expect(result.map((problem) => problem.id)).toEqual(["p-rising"]);
  });

  it("counts valid active values overall and by column", () => {
    const active = filters({
      title: "export",
      signalsMin: "3",
      signalsMax: "invalid",
      revenueMin: "50",
      severities: ["High", "Critical", "High"],
      trends: ["rising", "new"],
      confidenceMin: "",
      confidenceMax: 94,
      stages: ["Detected"],
    });

    expect(countActiveProblemTableFiltersByColumn(active)).toEqual({
      title: 1,
      signals: 1,
      revenue: 1,
      severity: 2,
      trend: 2,
      confidence: 1,
      stage: 1,
    });
    expect(countActiveProblemTableFiltersForColumn(active, "severity")).toBe(2);
    expect(countActiveProblemTableFilters(active)).toBe(9);
    expect(countActiveProblemTableFilterColumns(active)).toBe(7);
    expect(countActiveProblemTableFilters(createEmptyProblemTableFilters()))
      .toBe(0);
  });
});
