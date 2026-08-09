import type { OverviewAnalytics } from "./overview-analytics";

export const PROBLEM_TABLE_TRENDS = Object.freeze([
  "new",
  "rising",
  "flat",
  "falling",
] as const);

export type ProblemTableTrend = (typeof PROBLEM_TABLE_TRENDS)[number];
export type ProblemTableNumericFilterValue = string | number | null | undefined;

export const PROBLEM_TABLE_FILTER_COLUMNS = Object.freeze([
  "title",
  "signals",
  "revenue",
  "severity",
  "trend",
  "confidence",
  "stage",
] as const);

export type ProblemTableFilterColumn =
  (typeof PROBLEM_TABLE_FILTER_COLUMNS)[number];

export interface ProblemTableFilters {
  readonly title: string;
  readonly signalsMin: ProblemTableNumericFilterValue;
  readonly signalsMax: ProblemTableNumericFilterValue;
  /** Revenue bounds are entered in thousands of dollars. */
  readonly revenueMin: ProblemTableNumericFilterValue;
  readonly revenueMax: ProblemTableNumericFilterValue;
  readonly severities: readonly string[];
  readonly trends: readonly ProblemTableTrend[];
  readonly confidenceMin: ProblemTableNumericFilterValue;
  readonly confidenceMax: ProblemTableNumericFilterValue;
  readonly stages: readonly string[];
}

/**
 * Returns a deeply frozen default value so callers cannot accidentally share
 * mutable selection arrays. Call it again whenever a fresh reset value is
 * needed.
 */
export function createEmptyProblemTableFilters(): ProblemTableFilters {
  return Object.freeze({
    title: "",
    signalsMin: "",
    signalsMax: "",
    revenueMin: "",
    revenueMax: "",
    severities: Object.freeze([] as string[]),
    trends: Object.freeze([] as ProblemTableTrend[]),
    confidenceMin: "",
    confidenceMax: "",
    stages: Object.freeze([] as string[]),
  });
}

function parseNumericBound(
  value: ProblemTableNumericFilterValue,
  {
    multiplier = 1,
    minimum = 0,
    maximum = Number.POSITIVE_INFINITY,
  }: {
    multiplier?: number;
    minimum?: number;
    maximum?: number;
  } = {},
): number | null {
  if (value === null || value === undefined) return null;

  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;

  const parsed = typeof normalized === "number"
    ? normalized
    : Number(normalized);
  const scaled = parsed * multiplier;
  return Number.isFinite(scaled) && scaled >= minimum && scaled <= maximum
    ? scaled
    : null;
}

function isWithinInclusiveBounds(
  value: number,
  minimum: number | null,
  maximum: number | null,
): boolean {
  return (minimum === null || value >= minimum) &&
    (maximum === null || value <= maximum);
}

export function classifyProblemTableTrend(
  trend: OverviewAnalytics["problems"][number]["trend"],
): ProblemTableTrend {
  if (trend === null) return "new";
  if (trend > 0) return "rising";
  if (trend < 0) return "falling";
  return "flat";
}

/**
 * Applies OR semantics within multi-select columns and AND semantics between
 * columns. Array.prototype.filter preserves the source ranking/order.
 */
export function filterProblems(
  problems: OverviewAnalytics["problems"],
  filters: ProblemTableFilters,
): OverviewAnalytics["problems"] {
  const title = filters.title.trim().toLowerCase();
  const signalsMin = parseNumericBound(filters.signalsMin);
  const signalsMax = parseNumericBound(filters.signalsMax);
  const revenueMin = parseNumericBound(filters.revenueMin, {
    multiplier: 1_000,
  });
  const revenueMax = parseNumericBound(filters.revenueMax, {
    multiplier: 1_000,
  });
  const confidenceMin = parseNumericBound(filters.confidenceMin, {
    maximum: 100,
  });
  const confidenceMax = parseNumericBound(filters.confidenceMax, {
    maximum: 100,
  });
  const severities = new Set(filters.severities);
  const trends = new Set(filters.trends);
  const stages = new Set(filters.stages);

  return problems.filter((problem) =>
    (!title || problem.title.toLowerCase().includes(title)) &&
    isWithinInclusiveBounds(problem.count, signalsMin, signalsMax) &&
    isWithinInclusiveBounds(problem.revenue, revenueMin, revenueMax) &&
    (severities.size === 0 || severities.has(problem.severity)) &&
    (trends.size === 0 || trends.has(classifyProblemTableTrend(problem.trend))) &&
    isWithinInclusiveBounds(
      problem.confidence,
      confidenceMin,
      confidenceMax,
    ) &&
    (stages.size === 0 || stages.has(problem.stage))
  );
}

function countDistinctSelections(values: readonly string[]): number {
  return new Set(values).size;
}

/** Counts active values/bounds for one table column. */
export function countActiveProblemTableFiltersForColumn(
  filters: ProblemTableFilters,
  column: ProblemTableFilterColumn,
): number {
  switch (column) {
    case "title":
      return filters.title.trim() ? 1 : 0;
    case "signals":
      return Number(parseNumericBound(filters.signalsMin) !== null) +
        Number(parseNumericBound(filters.signalsMax) !== null);
    case "revenue":
      return Number(
        parseNumericBound(filters.revenueMin, { multiplier: 1_000 }) !== null,
      ) + Number(
        parseNumericBound(filters.revenueMax, { multiplier: 1_000 }) !== null,
      );
    case "severity":
      return countDistinctSelections(filters.severities);
    case "trend":
      return countDistinctSelections(filters.trends);
    case "confidence":
      return Number(
        parseNumericBound(filters.confidenceMin, { maximum: 100 }) !== null,
      ) + Number(
        parseNumericBound(filters.confidenceMax, { maximum: 100 }) !== null,
      );
    case "stage":
      return countDistinctSelections(filters.stages);
  }
}

export function countActiveProblemTableFiltersByColumn(
  filters: ProblemTableFilters,
): Readonly<Record<ProblemTableFilterColumn, number>> {
  return Object.freeze(
    Object.fromEntries(
      PROBLEM_TABLE_FILTER_COLUMNS.map((column) => [
        column,
        countActiveProblemTableFiltersForColumn(filters, column),
      ]),
    ) as Record<ProblemTableFilterColumn, number>,
  );
}

/** Counts every active value/bound across all columns. */
export function countActiveProblemTableFilters(
  filters: ProblemTableFilters,
): number {
  return Object.values(countActiveProblemTableFiltersByColumn(filters)).reduce(
    (total, count) => total + count,
    0,
  );
}

/** Counts columns that contain at least one active filter value/bound. */
export function countActiveProblemTableFilterColumns(
  filters: ProblemTableFilters,
): number {
  return Object.values(countActiveProblemTableFiltersByColumn(filters)).filter(
    (count) => count > 0,
  ).length;
}
