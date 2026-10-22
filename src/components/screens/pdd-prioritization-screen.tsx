"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CustomSelect } from "../custom-select";
import { type OverviewAnalytics } from "@/lib/overview-analytics";
import type { InvestigationWorkspaceItem } from "@/lib/investigation-repository";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { EngineeringPreparationSteps, engineeringPreparationSteps } from "../engineering-ticket-panel";
import { PageTitle, arrFragment } from "./shared";

function pddQueueTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("approval") || normalized.includes("execution")) return "success";
  if (normalized.includes("needed") || normalized.includes("required")) return "high";
  return "medium";
}

type PddRankMode = "readiness" | "revenue" | "signals" | "severity";

type PddReadinessFilter = "all" | "ready" | "preparing" | "active" | "approval";

const pddSeverityRank: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function pddPreparationState(input: {
  investigation?: InvestigationWorkspaceItem;
  workflow?: EngineeringWorkflowView;
  repositoryReady: boolean;
}) {
  const { investigation, workflow, repositoryReady } = input;
  const actionApprovalReady = Boolean(
    workflow?.run
      || workflow?.approval?.status === "Pending"
      || workflow?.approval?.status === "Approved",
  );
  const acceptanceReady = Boolean(
    actionApprovalReady || workflow?.verification?.status === "Ready for approval",
  );
  const promptReady = Boolean(
    workflow?.prompt && workflow.specification && workflow.readiness.ready,
  );
  const review = workflow?.promptEvaluation?.review;
  const promptAligned = Boolean(
    acceptanceReady
      || (review?.verdict === "Passed"
        && (!review.promptHash || review.promptHash === workflow?.prompt?.contentHash)),
  );
  const steps = engineeringPreparationSteps({
    repositoryProfileReady: repositoryReady,
    promptReady,
    promptAligned,
    acceptanceReady,
    approvalReady: actionApprovalReady,
  });
  const completed = steps.filter((step) => step.state === "complete").length;
  const evaluating = workflow?.promptEvaluation?.status === "Running";
  const issueVerified = investigation?.verification.status === "Confirmed current";
  const runtimeVerificationActive = investigation?.runtimeVerification?.status === "Queued"
    || investigation?.runtimeVerification?.status === "Running";
  const readyToTest = Boolean(issueVerified && repositoryReady && promptReady && !promptAligned && !evaluating);
  const category: Exclude<PddReadinessFilter, "all"> = !issueVerified
    ? "preparing"
    : actionApprovalReady
      ? "approval"
      : evaluating || promptAligned
        ? "active"
        : readyToTest
          ? "ready"
          : "preparing";
  const label = !investigation
    ? "Investigation required"
    : !issueVerified
      ? runtimeVerificationActive ? "Runtime verification running" : "Issue verification required"
      : category === "approval"
        ? "Approval ready"
        : category === "active"
          ? evaluating ? "Evaluating prompt" : "Acceptance preparation"
          : category === "ready"
            ? "Ready to prompt-test"
            : !repositoryReady
              ? "Repository setup required"
              : "Preparing prompt";
  const readinessBucket = category === "ready"
    ? 0
    : category === "active"
      ? 1
      : category === "preparing"
        ? 2
        : 3;
  return {
    steps,
    completed,
    category,
    label,
    readinessBucket,
    hasInvestigation: Boolean(investigation),
    issueVerified,
    runtimeVerificationActive,
  };
}

export function PddPrioritizationScreen({
  problems,
  investigations,
  workflows,
  repositoryReadyByProblem,
}: {
  problems: OverviewAnalytics["problems"];
  investigations: InvestigationWorkspaceItem[];
  workflows: Record<string, EngineeringWorkflowView>;
  repositoryReadyByProblem: Record<string, boolean>;
}) {
  const [rankMode, setRankMode] = useState<PddRankMode>("readiness");
  const [readinessFilter, setReadinessFilter] = useState<PddReadinessFilter>("all");
  const rows = useMemo(() => problems.map((problem) => {
    const investigation = investigations.find((item) => item.problemId === problem.id);
    return {
      problem,
      preparation: pddPreparationState({
        investigation,
        workflow: workflows[problem.id],
        repositoryReady: repositoryReadyByProblem[problem.id] ?? false,
      }),
    };
  }), [investigations, problems, repositoryReadyByProblem, workflows]);
  const visibleRows = useMemo(() => {
    const filtered = readinessFilter === "all"
      ? rows
      : rows.filter((row) => row.preparation.category === readinessFilter);
    return [...filtered].sort((left, right) => {
      if (rankMode === "revenue") return right.problem.revenue - left.problem.revenue;
      if (rankMode === "signals") return right.problem.count - left.problem.count;
      if (rankMode === "severity") {
        return (pddSeverityRank[right.problem.severity] ?? 0)
          - (pddSeverityRank[left.problem.severity] ?? 0)
          || right.problem.revenue - left.problem.revenue;
      }
      return left.preparation.readinessBucket - right.preparation.readinessBucket
        || right.preparation.completed - left.preparation.completed
        || right.problem.revenue - left.problem.revenue;
    });
  }, [rankMode, readinessFilter, rows]);

  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.pdd}
        action={
          <div className="pdd-list-controls">
            <CustomSelect
              ariaLabel="Filter Prompt Testing tasks by readiness"
              value={readinessFilter}
              onValueChange={(value) => setReadinessFilter(value as PddReadinessFilter)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "ready", label: "Ready to test" },
                { value: "preparing", label: "Needs preparation" },
                { value: "active", label: "Testing" },
                { value: "approval", label: "Ready for approval" },
              ]}
            />
            <CustomSelect
              ariaLabel="Sort Prompt Testing tasks"
              value={rankMode}
              onValueChange={(value) => setRankMode(value as PddRankMode)}
              options={[
                { value: "readiness", label: "Sort: readiness" },
                { value: "revenue", label: "Sort: affected revenue" },
                { value: "signals", label: "Sort: report count" },
                { value: "severity", label: "Sort: severity" },
              ]}
            />
          </div>
        }
      />

      <section className="pdd-priority-workspace">
        <div className="pdd-priority-head">
          <div>
            <h2>Test queue</h2>
            <p>{visibleRows.length === 1 ? "1 issue" : `${visibleRows.length} issues`}</p>
          </div>
          <span className="badge brand">{rows.filter((row) => row.preparation.category === "ready").length} ready to test</span>
        </div>

        {visibleRows.length ? (
          <ol className="pdd-priority-list">
            {visibleRows.map(({ problem, preparation }, index) => (
              <li key={problem.id}>
                <Link
                  className="pdd-priority-row"
                  href={`/pdd/${encodeURIComponent(problem.id)}#engineering-ticket`}
                >
                  <div className="pdd-priority-row-head">
                    <span className="prioritization-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                    <div className="pdd-priority-copy">
                      <div className="pdd-priority-title">
                        <h3>{problem.title}</h3>
                        <span className={`badge ${pddQueueTone(preparation.label)}`}>{preparation.label}</span>
                      </div>
                      <p>
                        {problem.productArea} · {problem.severity} severity{arrFragment(problem.revenue)} · {problem.count} signal{problem.count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="pdd-priority-open">
                      Open task
                      <ChevronRight size={15} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="pdd-priority-tracker" aria-label={`${problem.title} preparation progress`}>
                    <EngineeringPreparationSteps steps={preparation.steps} />
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty pdd-priority-empty">
            <strong>{rows.length ? "No matching tasks" : "No issues to test"}</strong>
            <p>
              {rows.length
                ? "Try another status or clear the filter."
                : "Review an issue to prepare its prompt."}
            </p>
            {rows.length ? (
              <button className="btn" type="button" onClick={() => setReadinessFilter("all")}>Clear filter</button>
            ) : (
              <Link className="btn" href="/problems">View issues</Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
