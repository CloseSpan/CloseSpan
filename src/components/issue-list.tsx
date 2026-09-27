"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Filter, Search, X } from "lucide-react";
import { CustomSelect } from "./custom-select";
import {
  activeIssueFilterCount,
  EMPTY_ISSUE_FILTERS,
  groupIssues,
  issueProductArea,
  type Issue,
  type IssueFilters,
  type IssueGrouping,
} from "@/lib/issue-views";
import { PRODUCT_PROBLEM_STAGES } from "@/lib/problem-stage-transition";

export function IssueViewControls({
  issues, filters, onFiltersChange, grouping, onGroupingChange, isBoard, count, children,
}: {
  issues: Issue[];
  filters: IssueFilters;
  onFiltersChange: (filters: IssueFilters) => void;
  grouping: IssueGrouping;
  onGroupingChange: (grouping: IssueGrouping) => void;
  isBoard: boolean;
  count: number;
  children?: ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const activeCount = activeIssueFilterCount(filters);
  const hasFilters = activeCount > 0 || Boolean(filters.query.trim());

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterRoot.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [filtersOpen]);

  const closeFilters = () => {
    setFiltersOpen(false);
    filterTrigger.current?.focus();
  };
  const fields = [
    { key: "productArea", label: "Product area", values: [...new Set(issues.map(issueProductArea))].sort() },
    { key: "type", label: "Type", values: [...new Set(issues.map((issue) => issue.type))].sort() },
    { key: "stage", label: "Stage", values: [...PRODUCT_PROBLEM_STAGES] },
    { key: "severity", label: "Severity", values: ["Critical", "High", "Medium", "Low"] },
  ] as const;

  return (
    <div className="card-head problem-table-head issue-controls issue-toolbar">
      <div className="issue-toolbar-title">
        <h2>{isBoard ? "Issue board" : "All issues"}</h2>
        <span className="issue-result-count" role="status">{count} {count === 1 ? "issue" : "issues"}</span>
      </div>
      <div className="issue-toolbar-controls">
        <label className="issue-search" data-field-shell>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search issues"
            placeholder="Search issues…"
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          />
        </label>
        <div className="issue-filter-root" ref={filterRoot} onKeyDown={(event) => {
          if (event.key === "Escape" && filtersOpen && !event.defaultPrevented) {
            event.preventDefault();
            closeFilters();
          }
        }}>
          <button
            className="btn"
            type="button"
            ref={filterTrigger}
            aria-expanded={filtersOpen}
            aria-controls={panelId}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Filter size={14} aria-hidden="true" /> Filters{activeCount > 0 && <span className="issue-filter-count">{activeCount}</span>}
          </button>
          {filtersOpen && (
            <div className="issue-filter-panel" id={panelId} role="region" aria-label="Issue filters">
              <div className="issue-filter-heading">
                <strong>Filters</strong>
                <button className="icon-btn" type="button" aria-label="Close filters" onClick={closeFilters}><X size={14} /></button>
              </div>
              {fields.map(({ key, label, values }) => (
                <div className="issue-filter-field" key={key}>
                  <span>{label}</span>
                  <CustomSelect
                    ariaLabel={`Filter by ${label.toLowerCase()}`}
                    value={filters[key]}
                    options={[{ value: "", label: "All" }, ...values.map((value) => ({ value, label: value }))]}
                    onValueChange={(value) => onFiltersChange({ ...filters, [key]: value })}
                  />
                </div>
              ))}
              <div className="issue-filter-footer">
                <button className="btn" type="button" disabled={!activeCount} onClick={() => onFiltersChange({ ...EMPTY_ISSUE_FILTERS, query: filters.query })}>Reset</button>
                <button className="btn" type="button" onClick={closeFilters}>Done</button>
              </div>
            </div>
          )}
        </div>
        <CustomSelect
          className="issue-group-select"
          ariaLabel="Group issues by"
          value={isBoard && grouping === "none" ? "stage" : grouping}
          options={[
            ...(!isBoard ? [{ value: "none", label: "Group: None" }] : []),
            { value: "productArea", label: "Group: Product area" },
            { value: "type", label: "Group: Type" },
            { value: "stage", label: "Group: Stage" },
          ]}
          onValueChange={(value) => onGroupingChange(value as IssueGrouping)}
        />
        {hasFilters && <button className="icon-btn issue-clear-filters" type="button" aria-label="Clear filters" title="Clear filters" onClick={() => onFiltersChange({ ...EMPTY_ISSUE_FILTERS })}><X size={14} aria-hidden="true" /></button>}
      </div>
      {children}
    </div>
  );
}

export function IssueList({ issues, grouping }: { issues: Issue[]; grouping: IssueGrouping }) {
  return (
    <div className="table-wrap issue-list-wrap">
      <table className="issue-list-table">
        <caption className="sr-only">Issues</caption>
        <thead><tr><th scope="col">Issue</th><th scope="col">Stage</th><th scope="col">Severity</th><th scope="col">Reports</th></tr></thead>
        {groupIssues(issues, grouping).map((group) => (
          <tbody key={group.key}>
            {grouping !== "none" && <tr className="issue-group-heading"><th colSpan={4} scope="rowgroup">{group.key}<span>{group.issues.length}</span></th></tr>}
            {group.issues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <Link className="issue-list-title" href={`/problems/${issue.id}`}>{issue.title}</Link>
                  <div className="issue-taxonomy"><span>{issueProductArea(issue)}</span><span aria-hidden="true">·</span><span>{issue.type}</span></div>
                </td>
                <td><span className="badge">{issue.stage}</span></td>
                <td><span className={`badge ${issue.severity.toLowerCase()}`}>{issue.severity}</span></td>
                <td className="issue-report-count">{issue.count}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
