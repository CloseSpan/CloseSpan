export const serviceStatuses = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;

export type ServiceStatus = (typeof serviceStatuses)[number];
export type HealthStatus = Exclude<ServiceStatus, "maintenance">;
export type HistoryStatus = ServiceStatus | "no_data";

export interface StateInput {
  currentStatus: HealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  consecutiveSlow: number;
  succeeded: boolean;
  slow: boolean;
}

export interface StateResult {
  status: HealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  consecutiveSlow: number;
}

export function shouldDeferPrelaunchProbe(input: {
  probeKind: string;
  lastCheckedAt: number | null;
  succeeded: boolean;
  errorCode: string | null;
}): boolean {
  if (input.succeeded || input.lastCheckedAt !== null) return false;
  if (input.probeKind !== "component" && input.probeKind !== "executor") return false;
  return input.errorCode === "not_configured"
    || input.errorCode === "http_404"
    || input.errorCode === "http_530";
}

export function nextServiceState(input: StateInput): StateResult {
  if (!input.succeeded) {
    const failures = input.consecutiveFailures + 1;
    return {
      status: failures >= 2 ? "major_outage" : "degraded",
      consecutiveFailures: failures,
      consecutiveSuccesses: 0,
      consecutiveSlow: 0,
    };
  }

  const successes = input.consecutiveSuccesses + 1;
  const slowChecks = input.slow ? input.consecutiveSlow + 1 : 0;
  const wasUnavailable = input.currentStatus === "major_outage" || input.currentStatus === "partial_outage";
  const recovered = !wasUnavailable || successes >= 2;
  return {
    status: recovered ? (slowChecks >= 3 ? "degraded" : "operational") : input.currentStatus,
    consecutiveFailures: 0,
    consecutiveSuccesses: successes,
    consecutiveSlow: slowChecks,
  };
}

const severityRank: Record<ServiceStatus, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function overallStatus(statuses: ServiceStatus[]): ServiceStatus {
  if (statuses.length === 0) return "operational";
  const healthStatuses = statuses.filter((status) => status !== "maintenance");
  if (healthStatuses.length === 0) return "maintenance";
  const majorCount = healthStatuses.filter((status) => status === "major_outage").length;
  if (majorCount >= 2) return "major_outage";
  if (majorCount === 1 || healthStatuses.includes("partial_outage")) return "partial_outage";
  if (healthStatuses.includes("degraded")) return "degraded";
  if (statuses.includes("maintenance")) return "maintenance";
  return "operational";
}

export function worstStatus(statuses: ServiceStatus[]): ServiceStatus {
  return statuses.reduce<ServiceStatus>(
    (worst, status) => severityRank[status] > severityRank[worst] ? status : worst,
    "operational",
  );
}

export function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function historyDays(now: number, count = 90): string[] {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() - (count - index - 1));
    return utcDay(day.getTime());
  });
}

export function uptimePercentage(successful: number, total: number, maintenance: number): number | null {
  const eligible = Math.max(0, total - maintenance);
  if (eligible === 0) return null;
  return Math.round((successful / eligible) * 100_000) / 1_000;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "incident";
}
