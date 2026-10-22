"use client";

import { useId } from "react";
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { type OverviewAnalytics } from "@/lib/overview-analytics";
import type { PromptDraftReadiness } from "@/lib/automated-prompt-draft-repository";
import type { InvestigationWorkspaceItem } from "@/lib/investigation-repository";
import { PageTitle, investigationStatusLabel, investigationStatusTone, money } from "./shared";

export function GenericProblemScreen({
  problem,
  promptDraftReadiness,
  investigation,
  discussion,
}: {
  problem: OverviewAnalytics["problems"][number];
  promptDraftReadiness: PromptDraftReadiness;
  investigation?: InvestigationWorkspaceItem;
  discussion?: React.ReactNode;
}) {
  const signalConfidenceHelpId = useId();
  const promptThresholdHelpId = useId();
  const relatedSignalsHelpId = useId();
  const evidenceNeededHelpId = useId();
  const recommendedChecksHelpId = useId();
  const investigationPercent = promptDraftReadiness.investigationConfidence === null
    ? null
    : Math.round(promptDraftReadiness.investigationConfidence * 100);
  const requiredPercent = Math.round(promptDraftReadiness.requiredConfidence * 100);
  const promptAlreadyCreated = promptDraftReadiness.hasExistingWorkflow;
  const issueVerified = promptDraftReadiness.verificationStatus === "Confirmed current";
  const needsInvestigationReview = investigationPercent === null || investigationPercent < requiredPercent;
  const promptBlockedReason = !issueVerified
    ? promptDraftReadiness.reason
    : promptAlreadyCreated
    ? "The suggested prompt is ready in Prompt Testing. Review the investigation below before continuing to testing."
    : needsInvestigationReview
      ? investigationPercent === null
        ? "Complete the investigation before generating a prompt."
        : "Review the open evidence gaps below before generating a prompt."
      : promptDraftReadiness.reason;
  const confidenceFactors = promptDraftReadiness.signalConfidenceFactors;
  const cogneeAssisted = confidenceFactors?.cogneeRetrieved === true;
  const confidenceFactorRows = [
    [cogneeAssisted ? "Semantic match (Cognee-assisted)" : "Semantic match", confidenceFactors?.clusterMatch ?? null, 0.65],
    ["Evidence quality", confidenceFactors?.evidenceQuality ?? null, 0.2],
    ["Low ambiguity", confidenceFactors?.lowAmbiguity ?? null, 0.15],
  ] as const;
  const investigationUpdatedAt = investigation ? new Date(investigation.updatedAt) : null;
  const investigationUpdatedLabel = !investigationUpdatedAt || Number.isNaN(investigationUpdatedAt.getTime())
    ? "Awaiting investigation"
    : `Updated ${investigationUpdatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return (
    <>
      <PageTitle
        eyebrow={`Issue · ${problem.id.replace("prob_", "CS-").toUpperCase()}`}
        title={problem.title}
        action={<div className="page-title-actions">
          <Link className="btn" href="/problems">
            <ChevronLeft size={14} aria-hidden="true" /> Back to issues
          </Link>
          <span className={`badge ${problem.severity.toLowerCase()}`}>
            {problem.severity}
          </span>
        </div>}
      />
      {discussion}
      <section className="card prompt-readiness-card">
          <div className="card-head">
            <div>
              <h2>Available evidence</h2>
            </div>
            <div className="investigation-detail-status">
              <span className={`badge ${investigation ? investigationStatusTone(investigation.status) : "high"}`}>
                {investigation ? investigationStatusLabel(investigation.status) : "Not started"}
              </span>
              <span className="subtle">{investigationUpdatedLabel}</span>
            </div>
          </div>
          <div className="card-body detail-stack">
            <p className="summary">
              This cluster has {problem.count} related signal{problem.count === 1 ? "" : "s"}
              {problem.revenue > 0 ? ` representing ${money(problem.revenue)} in affected ARR` : ""}.
            </p>
            <div className="prompt-readiness-grid" aria-label="Prompt drafting confidence">
              <div className="prompt-readiness-metric">
                <strong>{problem.confidence}%</strong>
                <span className="prompt-readiness-metric-label">
                  Signal match confidence
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What signal match confidence means"
                      aria-describedby={signalConfidenceHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={signalConfidenceHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip"
                    >
                      <strong className="prompt-tooltip-title">Signal evaluation</strong>
                      <span className="prompt-tooltip-breakdown">
                        {confidenceFactorRows.map(([label, score, weight]) => (
                          <span className="prompt-tooltip-row" key={label}>
                            <span>{label}</span>
                            <span>
                              {score === null
                                ? `Not stored × ${Math.round(weight * 100)}%`
                                : `${Math.round(score * 100)}% × ${Math.round(weight * 100)}% = `}
                              {score !== null && (
                                <strong>{Math.round(score * weight * 100)} pts</strong>
                              )}
                            </span>
                          </span>
                        ))}
                        <span className="prompt-tooltip-total">
                          <span>Total</span>
                          <strong>{problem.confidence}%</strong>
                        </span>
                      </span>
                      {!confidenceFactors && (
                        <span className="prompt-tooltip-note">
                          This older record stores only the final score; new evaluations retain
                          each factor.
                        </span>
                      )}
                      {cogneeAssisted && (
                        <span className="prompt-tooltip-note">
                          Cognee retrieved the accepted problem
                          {confidenceFactors.cogneeBestRank
                            ? ` at rank ${confidenceFactors.cogneeBestRank}`
                            : ""}. CloseSpan independently evaluated the semantic fit and applied
                          the weights shown above.
                        </span>
                      )}
                      <span className="prompt-tooltip-note">
                        This evaluates the initial report, not the number of similar reports.
                      </span>
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric prompt-readiness-threshold">
                <strong>{requiredPercent}%</strong>
                <span className="prompt-readiness-metric-label">
                  Required for prompt drafting
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What the prompt drafting requirement means"
                      aria-describedby={promptThresholdHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={promptThresholdHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip prompt-readiness-tooltip-end"
                    >
                      <strong className="prompt-tooltip-title">Prompt drafting gates</strong>
                      <span className="prompt-tooltip-breakdown">
                        <span className="prompt-tooltip-row">
                          <span>Confidence</span>
                          <strong>{requiredPercent}% minimum</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Linked evidence</span>
                          <strong>
                            {promptDraftReadiness.evidenceCount} / {promptDraftReadiness.requiredEvidence}
                          </strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Investigation</span>
                          <strong>{promptDraftReadiness.hasInvestigation ? "Present" : "Required"}</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Current issue</span>
                          <strong>{issueVerified ? "Confirmed" : "Verification required"}</strong>
                        </span>
                        <span className="prompt-tooltip-row">
                          <span>Repository</span>
                          <strong>{promptDraftReadiness.repositoryReady ? "Confirmed" : "Required"}</strong>
                        </span>
                      </span>
                      <span className="prompt-tooltip-note">
                        All gates must pass before a prompt can be generated.
                      </span>
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.relatedSignalCount ?? problem.count}</strong>
                <span className="prompt-readiness-metric-label">
                  Related signals
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What related signals means"
                      aria-describedby={relatedSignalsHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span id={relatedSignalsHelpId} role="tooltip" className="investigation-metric-tooltip">
                      Customer reports linked to this issue.
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.missingInformation.length ?? "—"}</strong>
                <span className="prompt-readiness-metric-label">
                  Evidence still needed
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What evidence still needed means"
                      aria-describedby={evidenceNeededHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span id={evidenceNeededHelpId} role="tooltip" className="investigation-metric-tooltip">
                      Open evidence gaps that should be resolved before treating the hypothesis as confirmed.
                    </span>
                  </span>
                </span>
              </div>
              <div className="prompt-readiness-metric">
                <strong>{investigation?.recommendedTests.length ?? "—"}</strong>
                <span className="prompt-readiness-metric-label">
                  Recommended checks
                  <span className="investigation-metric-help">
                    <button
                      type="button"
                      className="investigation-metric-help-trigger"
                      aria-label="What recommended checks means"
                      aria-describedby={recommendedChecksHelpId}
                    >
                      <Info size={14} aria-hidden="true" />
                    </button>
                    <span
                      id={recommendedChecksHelpId}
                      role="tooltip"
                      className="investigation-metric-tooltip prompt-readiness-tooltip-end"
                    >
                      Proposed verification checks from the investigation. These have not been completed yet.
                    </span>
                  </span>
                </span>
              </div>
            </div>
            <div className={`callout prompt-readiness-callout ${issueVerified && (promptDraftReadiness.canGenerate || promptAlreadyCreated) ? "success" : "warning"}`}>
              <div className="callout-title">
                {!issueVerified
                  ? "Current issue verification required"
                  : promptAlreadyCreated
                  ? "Suggested prompt created"
                  : promptDraftReadiness.canGenerate
                    ? "Ready to create a suggested prompt"
                    : needsInvestigationReview
                      ? "Investigation required"
                      : "Prompt context needs review"}
              </div>
              <p className="subtle" id="prompt-generation-status">
                {promptBlockedReason}
              </p>
            </div>
          </div>
      </section>
    </>
  );
}
