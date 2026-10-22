"use client";

import { ButtonLink } from "@/components/ui";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type OverviewAnalytics } from "@/lib/overview-analytics";
import type { InvestigationWorkspaceItem } from "@/lib/investigation-repository";
import type { EngineeringWorkflowView } from "@/lib/engineering-workflow-repository";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";
import { EmptyWorkspaceState, PageTitle, arrFragment } from "./shared";

export function PddScreen({
  problems,
  investigations,
  workflows,
  selectedProblemId,
  engineeringPanel,
}: {
  problems: OverviewAnalytics["problems"];
  investigations: InvestigationWorkspaceItem[];
  workflows: Record<string, EngineeringWorkflowView>;
  selectedProblemId: string | null;
  engineeringPanel?: React.ReactNode;
}) {
  const selectedProblem = problems.find((item) => item.id === selectedProblemId);
  const selected = investigations.find((item) => item.problemId === selectedProblemId);
  const selectedIssueVerified = selected?.verification.status === "Confirmed current";
  const selectedRuntimeVerificationActive = selected?.runtimeVerification?.status === "Queued"
    || selected?.runtimeVerification?.status === "Running";
  const selectedWorkflow = selectedProblemId ? workflows[selectedProblemId] : undefined;

  if (!selectedProblem) {
    return (
      <>
        <PageTitle
          title={WORKSPACE_LABELS.pdd}
        />
        <EmptyWorkspaceState
          title="Nothing is ready for Prompt Testing"
          description="Choose an issue to review its prompt."
          actionHref="/problems"
          actionLabel="View issues"
        />
      </>
    );
  }

  const currentPhase = !selectedWorkflow?.prompt
    ? 0
    : selectedWorkflow.approval || selectedWorkflow.verification?.status === "Ready for approval"
      ? 2
      : 1;
  const phases = ["Prompt preparation", "Prompt evaluation", "Approval readiness"];

  return (
    <>
      <PageTitle
        title={WORKSPACE_LABELS.pdd}
        action={
          <ButtonLink href="/pdd">
            <ChevronLeft size={14} aria-hidden="true" /> Back to Prompt Testing
          </ButtonLink>
        }
      />

      <div className="pdd-task-workspace">
        <div className="pdd-detail-stack">
          <section className="card pdd-selected-context">
            <div>
              <h2>{selectedProblem.title}</h2>
              <p>{selectedProblem.productArea} · {selectedProblem.severity} severity{arrFragment(selectedProblem.revenue)}</p>
            </div>
            <Link className="text-link" href={`/problems/${encodeURIComponent(selectedProblem.id)}#investigation`}>
              View issue <ChevronRight size={13} aria-hidden="true" />
            </Link>
          </section>
          <nav className="pdd-phase-rail card" aria-label="Prompt Testing preparation phases">
            {phases.map((phase, index) => (
              <span
                className={`pdd-phase is-${index < currentPhase ? "complete" : index === currentPhase ? "current" : "upcoming"}`}
                aria-current={index === currentPhase ? "step" : undefined}
                key={phase}
              >
                <span className="pdd-phase-marker" aria-hidden="true">
                  {index < currentPhase ? <Check size={13} /> : index + 1}
                </span>
                <strong>{phase}</strong>
              </span>
            ))}
          </nav>

          {selected && selectedIssueVerified ? (
            engineeringPanel
          ) : (
            <section className="card pdd-investigation-gate">
              <div className="card-head">
                <div>
                  <h2>{!selected
                    ? "Investigation required"
                    : selectedRuntimeVerificationActive
                      ? "Runtime verification in progress"
                      : selected.verification.status === "Verification blocked"
                        ? "Current issue verification blocked"
                        : "Current issue verification required"}</h2>
                  <p className="subtle">{!selected
                    ? "Confirm the problem hypothesis and evidence boundary before testing an implementation prompt."
                    : selectedRuntimeVerificationActive
                      ? "CloseSpan is checking the reported behavior. Prompt testing will unlock when the current issue is confirmed."
                      : selected.verification.status === "Verification blocked"
                        ? "Prompt testing is paused because the last verification could not confirm or disprove the reported behavior. Resolve the recorded blocker, then run verification again."
                        : "Reproduce the reported behavior and record the result before testing an implementation prompt."}</p>
                </div>
                <span className="badge high">Blocked</span>
              </div>
              <div className="card-body">
                <ButtonLink variant="primary" href={`/problems/${encodeURIComponent(selectedProblem.id)}#investigation`}>
                  {selectedRuntimeVerificationActive
                    ? "View runtime verification"
                    : selected?.verification.status === "Verification blocked"
                      ? "Resolve verification blocker"
                      : "View issue"}
                  <ChevronRight size={14} aria-hidden="true" />
                </ButtonLink>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
