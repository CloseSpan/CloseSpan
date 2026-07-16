import type { ApprovalRequest, FeedbackItem, ProductProblem, Recommendation } from "./domain";

export const ORG_ID = "org_northstar";

export const feedback: FeedbackItem[] = [
  { id: "fb_001", orgId: ORG_ID, source: "Intercom", customer: "Northstar Labs", accountTier: "Enterprise", arr: 184000, type: "Bug", severity: "High", redacted: true, environment: "Chrome 126 · macOS · v4.18.2", problemId: "prob_export", confidence: 0.96, observedAt: "Today, 09:42", quote: "CSV exports with more than 10k rows finish, but the download is blank. [email redacted]" },
  { id: "fb_002", orgId: ORG_ID, source: "Zendesk", customer: "Acme Health", accountTier: "Enterprise", arr: 142000, type: "Bug", severity: "High", redacted: true, environment: "Edge 126 · Windows 11 · v4.18.2", problemId: "prob_export", confidence: 0.93, observedAt: "Today, 08:17", quote: "Our quarterly export says complete, then gives us a zero-byte file." },
  { id: "fb_003", orgId: ORG_ID, source: "Slack", customer: "Atlas Cloud", accountTier: "Growth", arr: 68000, type: "Bug", severity: "Medium", redacted: true, environment: "Chrome 125 · macOS · v4.18.2", problemId: "prob_export", confidence: 0.89, observedAt: "Yesterday, 16:08", quote: "Large report download is empty again. Small exports work." },
  { id: "fb_004", orgId: ORG_ID, source: "Survey", customer: "Luma Systems", accountTier: "Growth", arr: 44000, type: "Feature request", severity: "Low", redacted: false, environment: "Web · v4.18.1", problemId: "prob_filters", confidence: 0.84, observedAt: "Yesterday, 11:30", quote: "Please let us save a filtered dashboard view for our weekly review." },
  { id: "fb_005", orgId: ORG_ID, source: "Email", customer: "Orbit Works", accountTier: "Starter", arr: 12000, type: "Usability", severity: "Medium", redacted: true, environment: "Safari 17 · macOS · v4.18.2", confidence: 0.71, observedAt: "Mon, 14:22", quote: "I cannot tell whether inviting a teammate succeeded." },
];

export const primaryProblem: ProductProblem = {
  id: "prob_export", orgId: ORG_ID,
  title: "Large CSV exports produce empty files",
  statement: "Customers exporting datasets above approximately 10,000 rows receive an empty or zero-byte CSV despite a successful completion state.",
  summary: "Three customers across two paid tiers reported the same failure after release 4.18.2. Small exports remain healthy, suggesting a size-dependent regression in asynchronous export finalization.",
  stage: "Needs review", severity: "High", confidence: 0.92, productArea: "Analytics exports", team: "Data Experience",
  feedbackIds: ["fb_001", "fb_002", "fb_003"], churnRisk: 72, suspectedRepository: "acme/analytics-api",
  suspectedFiles: ["services/exports/finalize.ts", "workers/csv-export.ts", "lib/object-storage.ts"],
  impactFactors: [
    { key: "frequency", label: "Frequency", value: 76, weight: 20, evidence: "3 reports from 3 accounts in 26 hours" },
    { key: "severity", label: "Severity", value: 85, weight: 20, evidence: "Core reporting workflow is blocked" },
    { key: "revenue", label: "Revenue", value: 88, weight: 20, evidence: "$394k ARR directly affected" },
    { key: "churnRisk", label: "Churn risk", value: 72, weight: 15, evidence: "One renewal is due within 45 days" },
    { key: "customerTier", label: "Customer tier", value: 90, weight: 10, evidence: "2 enterprise accounts affected" },
    { key: "strategicAlignment", label: "Strategic alignment", value: 65, weight: 5, evidence: "Reliability is a Q3 product objective" },
    { key: "sla", label: "SLA", value: 80, weight: 5, evidence: "Enterprise response window has 9h remaining" },
    { key: "engineeringEffort", label: "Effort", value: 62, weight: 5, evidence: "Likely isolated worker and storage change" },
  ],
};

export const recommendation: Recommendation = {
  id: "rec_001", orgId: ORG_ID, problemId: primaryProblem.id, confidence: 0.68,
  hypothesis: "The export worker marks jobs complete before the multipart object upload is finalized when the output crosses the buffered-write threshold.",
  assumptions: ["Reports began after v4.18.2", "All three messages refer to the same export pipeline", "Repository metadata is current"],
  missingInformation: ["Exact row count for fb_003", "Object-storage request ID from one failed export"],
  proposedAction: "Create a simulated GitHub issue with evidence, reproduction guidance, suspected files, and an implementation plan.",
  tests: ["Boundary test at 9,999 / 10,000 / 10,001 rows", "Assert upload finalization precedes completed state", "Retry interrupted multipart upload"],
};

export const approval: ApprovalRequest = {
  id: "apr_001", orgId: ORG_ID, problemId: primaryProblem.id, recommendationId: recommendation.id,
  action: "Create GitHub issue in acme/analytics-api", reason: "Three corroborating reports indicate a release-linked regression affecting $394k ARR.",
  confidence: 0.68, systems: ["GitHub (simulated)"], dataShared: ["Redacted customer quotes", "Environment metadata", "Repository file paths"],
  reversible: true, risk: "Low", status: "Pending",
};

export const otherProblems = [
  { id: "prob_filters", title: "Saved views lose advanced filters", severity: "Medium", stage: "Detected", count: 7, revenue: 216000, confidence: 86, trend: "+32%" },
  { id: "prob_sso", title: "SAML role mapping ignores group changes", severity: "Critical", stage: "In progress", count: 4, revenue: 612000, confidence: 94, trend: "+12%" },
  { id: "prob_invites", title: "Team invite confirmation is unclear", severity: "Low", stage: "Planned", count: 12, revenue: 98000, confidence: 78, trend: "−8%" },
];
