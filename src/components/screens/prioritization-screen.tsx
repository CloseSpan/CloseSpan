"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Filter } from "lucide-react";
import { CustomSelect } from "../custom-select";
import { formatTrend, type OverviewAnalytics } from "@/lib/overview-analytics";
import type { FeedbackType } from "@/lib/domain";
import { EmptyWorkspaceState, PageTitle, compactMoney } from "./shared";

export function PrioritizationScreen({
  analytics,
}: {
  analytics: OverviewAnalytics;
}) {
  const [typeFilter, setTypeFilter] = useState<"All" | FeedbackType>("All");
  const allRows = analytics.problems;
  const rows =
    typeFilter === "All"
      ? allRows
      : allRows.filter((problem) => problem.type === typeFilter);

  return (
    <>
      <PageTitle
        title="Prioritization"
        action={
          <CustomSelect
            className="prioritization-type-filter"
            ariaLabel="Filter prioritization by type"
            leadingIcon={<Filter aria-hidden="true" size={14} />}
            value={typeFilter}
            onValueChange={(value) =>
              setTypeFilter(value as "All" | FeedbackType)
            }
            options={[
              { value: "All", label: "All types" },
              { value: "Bug", label: "Bugs" },
              { value: "Feature request", label: "Features" },
              { value: "Usability", label: "Usability" },
              { value: "Incident", label: "Incidents" },
              { value: "Question", label: "Questions" },
            ]}
          />
        }
      />
      {allRows.length === 0 ? (
        <EmptyWorkspaceState
          title="Nothing to prioritize"
          description="There are no issues to prioritize yet."
          actionHref="/feedback"
          actionLabel="Review feedback"
        />
      ) : (
        <>
          <div className="prioritization-summary" role="status">
            <div>
              <span>Decision queue</span>
              <strong>{rows.length}</strong>
              <small>
                {typeFilter === "All"
                  ? "ranked problems"
                  : `${typeFilter.toLowerCase()} problems`}
              </small>
            </div>
            <div>
              <span>Revenue represented</span>
              <strong>
                {(() => {
                  const represented = rows.reduce((total, problem) => total + problem.revenue, 0);
                  return represented > 0 ? compactMoney(represented) : "—";
                })()}
              </strong>
            </div>
            <div>
              <span>Needs evidence review</span>
              <strong>
                {
                  rows.filter(
                    (problem) =>
                      problem.stage === "Needs review" ||
                      problem.confidence < 80,
                  ).length
                }
              </strong>
            </div>
          </div>
          {rows.length === 0 ? (
            <section className="card section-gap">
              <div className="card-body">
                <p className="subtle">
                  No {typeFilter.toLowerCase()} problems match this filter.
                </p>
              </div>
            </section>
          ) : (
            <section className="prioritization-workspace">
              <div className="prioritization-queue-head">
                <div>
                  <h2>Impact review queue</h2>
                </div>
                <Link className="text-link" href="/settings#priority">
                  Review policy settings
                </Link>
              </div>
              <ol className="prioritization-decision-list">
                {rows.map((problem, index) => {
                  const trendLabel = formatTrend(problem.trend);
                  const evidenceNeedsReview =
                    problem.stage === "Needs review" ||
                    problem.confidence < 80;
                  return (
                    <li
                      className="prioritization-decision-row"
                      key={problem.id}
                    >
                      <span
                        className="prioritization-rank"
                        aria-label={`Rank ${index + 1}`}
                      >
                        {index + 1}
                      </span>
                      <div className="prioritization-decision-main">
                        <div className="prioritization-decision-title">
                          <Link href={`/problems/${problem.id}`}>
                            {problem.title}
                          </Link>
                          <span
                            className={`badge ${problem.severity.toLowerCase()}`}
                          >
                            {problem.severity}
                          </span>
                        </div>
                        <div
                          className="prioritization-drivers"
                          aria-label="Priority drivers"
                        >
                          {problem.revenue > 0 && (
                            <span>
                              <strong>{compactMoney(problem.revenue)}</strong> ARR
                            </span>
                          )}
                          <span>
                            <strong>{problem.count}</strong>{" "}
                            {problem.count === 1 ? "signal" : "signals"}
                          </span>
                          <span>
                            <strong>{trendLabel}</strong> trend
                          </span>
                          <span>
                            <strong>{problem.confidence}%</strong> evidence
                          </span>
                        </div>
                      </div>
                      <div className="prioritization-decision-state">
                        <span className="badge brand">{problem.stage}</span>
                        {evidenceNeedsReview ? (
                          <small>Evidence review required</small>
                        ) : (
                          <small>Ready to compare</small>
                        )}
                      </div>
                      <Link
                        className="prioritization-review-link"
                        href={`/problems/${problem.id}#evidence`}
                      >
                        Review evidence{" "}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
    </>
  );
}
