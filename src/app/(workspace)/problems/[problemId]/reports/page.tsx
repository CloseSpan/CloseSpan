import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { getOverviewAnalytics } from "@/lib/overview-repository";
import { getEngineeringWorkflow } from "@/lib/engineering-workflow-repository";
import { readIssueReports } from "@/lib/issue-lifecycle-repository";
import { readProblemPromptReview } from "@/lib/problem-prompt-review-repository";
import styles from "@/components/issue-detail.module.css";

export const dynamic = "force-dynamic";

export default async function IssueReportsPage({ params }: { params: Promise<{ problemId: string }> }) {
  const user = await requireWorkspaceUser();
  const { problemId } = await params;
  const analytics = await getOverviewAnalytics(user.orgId);
  const problem = analytics.problems.find((item) => item.id === problemId);
  if (!problem) notFound();
  const [reports, workflow, review] = await Promise.all([
    readIssueReports(user.orgId, problemId), getEngineeringWorkflow(user.orgId, problemId),
    readProblemPromptReview(user.orgId, problemId).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") return null;
      throw error;
    }),
  ]);
  const currentReview = review?.promptHash && review.promptHash === workflow.prompt?.contentHash ? review : null;
  const expectedBehavior = currentReview?.userStory || workflow.specification?.expectedBehavior;
  return <div className={styles.page}>
    <Link className={`text-link ${styles.back}`} href={`/problems/${encodeURIComponent(problemId)}`}><ArrowLeft size={14} aria-hidden="true" /> Back to issue</Link>
    <header className="page-head"><h1>{problem.title}</h1></header>
    <section className={styles.section} aria-labelledby="original-reports-heading">
      <h2 id="original-reports-heading">Original reports</h2>
      {reports.length ? <div className={styles.reports}>{reports.map((report) => <figure key={report.id}>
        <blockquote>{report.quote}</blockquote><figcaption>{report.customer} · {report.source}</figcaption>
      </figure>)}</div> : <p className={styles.note}>No original report text is available for this issue.</p>}
      {problem.count > reports.length && <p className={styles.note}>Showing the first {reports.length} of {problem.count} reports.</p>}
    </section>
    {workflow.specification?.currentBehavior && <section className={styles.section} aria-labelledby="reported-behavior">
      <h2 id="reported-behavior">Reported behavior</h2><p className={styles.body}>{workflow.specification.currentBehavior}</p>
    </section>}
    {expectedBehavior && <section className={styles.section} aria-labelledby="expected-behavior">
      <h2 id="expected-behavior">Expected behavior</h2><p className={styles.body}>{expectedBehavior}</p>
    </section>}
    {workflow.run?.implementationSummary && <section className={styles.section} aria-labelledby="implementation-result">
      <h2 id="implementation-result">Recorded implementation result</h2><p className={styles.body}>{workflow.run.implementationSummary}</p>
    </section>}
  </div>;
}
