export const problemActiveWorkStatuses = [
  "Testing",
  "Preparing",
  "Queued",
  "Tenki",
  "Working",
  "CI",
  "Merging",
  "Deploying",
  "Verifying",
] as const;

export type ProblemActiveWorkStatus =
  (typeof problemActiveWorkStatuses)[number];

export interface ProblemActiveWork {
  problemId: string;
  status: ProblemActiveWorkStatus;
  startedAt: string;
}

export function isProblemActiveWork(value: unknown): value is ProblemActiveWork {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProblemActiveWork>;
  return Boolean(
    typeof candidate.problemId === "string"
      && problemActiveWorkStatuses.some((status) => status === candidate.status)
      && typeof candidate.startedAt === "string",
  );
}
