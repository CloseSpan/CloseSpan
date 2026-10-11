import { createHash } from "node:crypto";
import type { AgentRunSummaryView } from "./engineering-workflow-repository";

export type RunFinding = {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  nextStep: string;
  repository: string | null;
  sourceProblemId: string;
  runIds: string[];
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
};

const reasons: Record<string, { title: string; explanation: string; nextStep: string }> = {
  verification: { title: "Independent verification failed", explanation: "The independent verifier reported a failure. This does not establish the underlying cause.", nextStep: "Review the verification evidence before approving another run." },
  tests: { title: "Automated tests failed", explanation: "The implementation report contains failed test results.", nextStep: "Inspect the failing tests and compare them with the accepted requirements." },
  final_execution: { title: "Final execution failed", explanation: "The latest final execution attempt failed after the implementation run.", nextStep: "Review final execution details. A successful implementation does not prove a successful release." },
  stale_base: { title: "Repository changed after approval", explanation: "The execution reported that its approved repository base is stale.", nextStep: "Review the current repository revision and obtain fresh approval." },
  timeout: { title: "Execution timed out", explanation: "The executor reported a timeout. A timeout alone does not prove a retry loop.", nextStep: "Inspect the last completed step and execution limits before retrying." },
  dispatch: { title: "Executor could not start", explanation: "The run reported an executor dispatch failure.", nextStep: "Check execution provider configuration and availability before retrying." },
  failed: { title: "Agent execution failed", explanation: "The run ended with a failure. No specific root cause has been established.", nextStep: "Open the run details and inspect its failure evidence." },
};

function signals(run: AgentRunSummaryView): string[] {
  const result: string[] = [];
  if (run.finalExecutionStatus === "Failed") result.push("final_execution");
  if (run.independentVerificationStatus === "failed") result.push("verification");
  if ((run.failedTestCount ?? 0) > 0) result.push("tests");
  if (run.status === "Failed") {
    const code = run.failureCode ?? "";
    const kind = code === "stale_base" ? "stale_base" : /timeout|timed_out/.test(code) ? "timeout" : /dispatch|executor_unavailable/.test(code) ? "dispatch" : "failed";
    // Generic failures must not merge unrelated error messages. Unknown codes
    // stay scoped to the originating issue and exact code, without raw log data.
    if (kind !== "failed" || !result.length) result.push(kind === "failed" ? `failed:${code}` : kind);
  }
  return result;
}

/** Deterministic analysis of a bounded, organization-scoped snapshot. No AI claims. */
export function detectRunFindings(runs: AgentRunSummaryView[]): RunFinding[] {
  const groups = new Map<string, RunFinding>();
  for (const run of runs) {
    for (const signal of signals(run)) {
      const kind = signal.split(":")[0];
      const reason = reasons[kind];
      const id = createHash("sha256").update(JSON.stringify([run.repository, run.problemId, signal])).digest("hex");
      const seen = run.completedAt ?? run.queuedAt;
      const finding = groups.get(id);
      if (finding) {
        if (!finding.runIds.includes(run.id)) finding.runIds.push(run.id);
        if (seen < finding.firstSeen) finding.firstSeen = seen;
        if (seen > finding.lastSeen) finding.lastSeen = seen;
      } else {
        groups.set(id, { id, kind, ...reason, repository: run.repository, sourceProblemId: run.problemId, runIds: [run.id], firstSeen: seen, lastSeen: seen, resolved: false });
      }
    }
  }
  for (const finding of groups.values()) {
    // A later clean, verified run supersedes execution/verification findings;
    // a failed release requires a later successful final execution instead.
    finding.resolved = runs.some((run) => run.problemId === finding.sourceProblemId && run.repository === finding.repository
      && run.queuedAt > finding.lastSeen && run.completedAt !== null
      && (finding.kind === "final_execution" ? run.finalExecutionStatus === "Succeeded"
        : ["Tests passed", "Draft PR opened", "No changes"].includes(run.status)
          && run.independentVerificationStatus === "passed" && !signals(run).length));
  }
  return [...groups.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
