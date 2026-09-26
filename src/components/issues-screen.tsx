"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getIssueStage, ISSUE_GROUPS, type IssueStage } from "@/lib/issue-stage";
import type { ProblemActiveWork } from "@/lib/problem-active-work";
import styles from "./issues-screen.module.css";
import { GooeyViewSwitch } from "./gooey-view-switch";

export interface IssueListItem {
  id: string;
  title: string;
  stage: string;
  severity: string;
  reviewState?: "needed" | "attention" | null;
  activeWork?: ProblemActiveWork | null;
  reportCount?: number;
}

export const ISSUE_QUEUE_FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "in-progress", label: "In progress" },
  { value: "closed", label: "Closed" },
] as const;

export type IssueQueueFilter = (typeof ISSUE_QUEUE_FILTERS)[number]["value"];

function getIssueQueue(issue: IssueListItem): Exclude<IssueQueueFilter, "all"> | null {
  const stage = getIssueStage(issue);
  if (stage.group === "Closed") return "closed";
  if (stage.group === "Needs review") return "attention";
  if (stage.group === "In progress" || (stage.group === "Release" && stage.tone === "active")) return "in-progress";
  return null;
}

function getIssuePriority(issue: IssueListItem): number {
  const queue = getIssueQueue(issue);
  if (queue === "attention") return issue.reviewState === "attention" ? 0 : 1;
  if (queue === "in-progress") return 2;
  if (queue === "closed") return 4;
  return 3;
}

function getIssueAction(issue: IssueListItem): string {
  const stage = getIssueStage(issue);
  if (stage.group === "Needs review") return "Review issue";
  if (getIssueQueue(issue) === "in-progress") return "View progress";
  if (stage.group === "Release") return "View result";
  return "View issue";
}

function getIssueCountLabel(count: number, filter: IssueQueueFilter): string {
  const subject = `${count} ${count === 1 ? "issue" : "issues"}`;
  if (filter === "attention") return `${subject} ${count === 1 ? "needs" : "need"} attention`;
  if (filter === "in-progress") return `${subject} in progress`;
  if (filter === "closed") return `${subject} closed`;
  return subject;
}

export function getIssueQueueCounts(issues: IssueListItem[]): Record<IssueQueueFilter, number> {
  const counts = { all: issues.length, attention: 0, "in-progress": 0, closed: 0 };
  for (const issue of issues) {
    const queue = getIssueQueue(issue);
    if (queue) counts[queue] += 1;
  }
  return counts;
}

export function filterIssues(issues: IssueListItem[], query: string, filter: IssueQueueFilter = "all"): IssueListItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return issues.filter((issue) => {
    if (filter !== "all" && getIssueQueue(issue) !== filter) return false;
    const text = `${issue.title} ${getIssueStage(issue).label} ${issue.severity}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((left, right) => getIssuePriority(left) - getIssuePriority(right));
}

function IssueStatus({ stage }: { stage: IssueStage }) {
  return <span className={styles.status} data-tone={stage.tone}>
    <span className={styles.statusDot} aria-hidden="true" />
    {stage.label}
  </span>;
}

function IssueMetadata({ issue }: { issue: IssueListItem }) {
  if (!issue.severity && issue.reportCount === undefined) return null;
  return <span className={styles.metadata}>
    {issue.reportCount !== undefined && <span>{issue.reportCount} {issue.reportCount === 1 ? "report" : "reports"}</span>}
    {issue.severity && <span>{issue.severity} severity</span>}
  </span>;
}

function IssueAction({ issue }: { issue: IssueListItem }) {
  return <span className={styles.rowAction} data-attention={getIssueQueue(issue) === "attention"}>
    {getIssueAction(issue)}<ChevronRight size={14} aria-hidden="true" />
  </span>;
}

export function IssueCollection({ issues, view }: { issues: IssueListItem[]; view: "list" | "board" }) {
  if (view === "board") {
    return <div className={styles.board} aria-label="Issues by stage">
      {ISSUE_GROUPS.map((group) => {
        const groupedIssues = issues.filter((issue) => getIssueStage(issue).group === group);
        if (groupedIssues.length === 0) return null;
        return <section className={styles.column} key={group}>
          <h2>{group}<span>{groupedIssues.length}</span></h2>
          <ul className={styles.boardItems}>
            {groupedIssues.map((issue) => <li key={issue.id}>
              <Link className={styles.boardIssue} href={`/problems/${encodeURIComponent(issue.id)}`}>
                <span className={styles.subjectCell}>
                  <span className={styles.subject} title={issue.title}>{issue.title}</span>
                  <IssueMetadata issue={issue} />
                </span>
                <IssueStatus stage={getIssueStage(issue)} />
                <IssueAction issue={issue} />
              </Link>
            </li>)}
          </ul>
        </section>;
      })}
    </div>;
  }

  return <div className={styles.list}>
    <div className={styles.listHeader} aria-hidden="true">
      <span>Issue</span><span>Status</span><span />
    </div>
    <ul aria-label="Issues">
      {issues.map((issue) => <li key={issue.id}>
        <Link className={styles.issueRow} href={`/problems/${encodeURIComponent(issue.id)}`}>
          <span className={styles.subjectCell}><span className={styles.subject} title={issue.title}>{issue.title}</span>
            <IssueMetadata issue={issue} />
          </span>
          <IssueStatus stage={getIssueStage(issue)} />
          <IssueAction issue={issue} />
        </Link>
      </li>)}
    </ul>
  </div>;
}

export function IssuesScreen({ issues, presentationDemo = false }: { issues: IssueListItem[]; presentationDemo?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState<IssueQueueFilter>("all");
  const queueCounts = getIssueQueueCounts(issues);
  const visibleIssues = filterIssues(issues, query, filter);
  const emptyQueue = {
    all: { title: "No issues yet", detail: "Issues appear here after imported feedback is reviewed." },
    attention: { title: "No issues need attention", detail: "Issues that need a decision will appear here." },
    "in-progress": { title: "No issues in progress", detail: "Queued and active work will appear here." },
    closed: { title: "No closed issues", detail: "Closed issues will appear here." },
  }[filter];

  useEffect(() => {
    if (presentationDemo) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, presentationDemo]);

  return <div className={styles.screen}>
    <header className={styles.header}>
      <h1>Issues</h1>
      {presentationDemo && <span className="badge">Demo · sample data</span>}
    </header>

    {issues.length === 0 ? <section className={styles.empty}>
      <h2>No issues yet</h2>
      <p>Issues appear here after imported feedback is reviewed.</p>
      <Link className="btn" href="/feedback">View feedback</Link>
    </section> : <>
      <div className={styles.queueFilters} role="group" aria-label="Filter issues">
        {ISSUE_QUEUE_FILTERS.map(({ value, label }) => <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          aria-label={`${label}, ${queueCounts[value]} ${queueCounts[value] === 1 ? "issue" : "issues"}`}
          onClick={() => setFilter(value)}
        >{label}<span className={styles.filterCount}>{queueCounts[value]}</span></button>)}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.search} data-field-shell>
          <Search size={16} aria-hidden="true" />
          <input id="issue-search" className="neumorphic-composite-field" type="search" aria-label="Search issues" placeholder="Search issues…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <GooeyViewSwitch value={view} onChange={setView} />
      </div>
      <p className={styles.resultCount} role="status" aria-live="polite">
        {query.trim()
          ? `${visibleIssues.length} of ${queueCounts[filter]} issues${filter === "all" ? "" : " in this queue"} match your search`
          : `${getIssueCountLabel(visibleIssues.length, filter)}${filter === "all" && view === "list" && queueCounts.attention > 0 ? " · Needs attention first" : ""}`}
      </p>
      {visibleIssues.length > 0 ? <IssueCollection issues={visibleIssues} view={view} /> : <section className={styles.empty}>
        <h2>{query.trim() ? "No matching issues" : emptyQueue.title}</h2>
        <p>{query.trim() ? "Try a different subject, status, or severity." : emptyQueue.detail}</p>
        {query.trim()
          ? <button className="btn" type="button" onClick={() => setQuery("")}>Clear search</button>
          : <button className="btn" type="button" onClick={() => setFilter("all")}>View all issues</button>}
      </section>}
    </>}
  </div>;
}
