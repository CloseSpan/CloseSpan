import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const orgId = argument("org-id") || process.env.DEMO_ORG_ID?.trim();
const ownerEmail = (
  argument("owner-email") || process.env.DEMO_OWNER_EMAIL || ""
).trim().toLowerCase();

if (process.env.APP_MODE !== "production") {
  throw new Error("APP_MODE=production is required before provisioning a private demo tenant");
}
if (process.env.PERSISTENCE_MODE !== "postgres") {
  throw new Error("PERSISTENCE_MODE=postgres is required before provisioning demo data");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!orgId) throw new Error("Set DEMO_ORG_ID or pass --org-id");
if (!ownerEmail || !ownerEmail.includes("@")) {
  throw new Error("Set DEMO_OWNER_EMAIL to the verified Google account that owns the demo");
}
if (["org_feelow", "org_northstar"].includes(orgId)) {
  throw new Error("Refusing to replace a protected workspace; use the newly created Demo organization id");
}

const DAY = 24 * 60 * 60 * 1_000;
const now = new Date();
const currentWeekStart = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
currentWeekStart.setUTCDate(
  currentWeekStart.getUTCDate() - ((currentWeekStart.getUTCDay() + 6) % 7),
);

function eventDate(weeksAgo, dayOffset, hourOffset = 0) {
  const value = new Date(
    currentWeekStart.getTime() - weeksAgo * 7 * DAY + dayOffset * DAY,
  );
  value.setUTCHours(9 + (hourOffset % 8), (hourOffset * 11) % 60, 0, 0);
  if (value > now) return new Date(now.getTime() - (hourOffset + 1) * 60 * 60 * 1_000);
  return value;
}

const accounts = [
  ["acct_demo_acme", "Acme Health", 210000, "Enterprise", 2022, "Elevated"],
  ["acct_demo_atlas", "Atlas Cloud", 184000, "Enterprise", 2021, "Elevated"],
  ["acct_demo_meridian", "Meridian Labs", 156000, "Enterprise", 2023, "Elevated"],
  ["acct_demo_hightower", "Hightower Finance", 132000, "Enterprise", 2020, "Elevated"],
  ["acct_demo_lumon", "Lumon Systems", 118000, "Growth", 2023, "Elevated"],
  ["acct_demo_orbit", "Orbit Commerce", 96000, "Growth", 2024, "Medium"],
  ["acct_demo_nova", "Nova Robotics", 88000, "Growth", 2024, "Medium"],
  ["acct_demo_willow", "Willow Health", 76000, "Growth", 2023, "Low"],
  ["acct_demo_cascade", "Cascade Legal", 64000, "Growth", 2022, "Medium"],
  ["acct_demo_pioneer", "Pioneer Labs", 52000, "Starter", 2025, "Low"],
  ["acct_demo_starlight", "Starlight Media", 44000, "Starter", 2025, "Low"],
  ["acct_demo_mosaic", "Mosaic Works", 36000, "Starter", 2025, "Low"],
];

const accountById = new Map(
  accounts.map(([id, name, arr, tier]) => [id, { name, arr, tier }]),
);

function impactFactors(frequency, severity, revenue, churnRisk, effort) {
  return [
    { key: "frequency", label: "Frequency", value: frequency, weight: 20, evidence: `${frequency}/100 signal frequency` },
    { key: "severity", label: "Severity", value: severity, weight: 20, evidence: `${severity}/100 operational severity` },
    { key: "revenue", label: "Revenue", value: revenue, weight: 20, evidence: `${revenue}/100 affected ARR` },
    { key: "churnRisk", label: "Churn risk", value: churnRisk, weight: 15, evidence: `${churnRisk}/100 renewal risk` },
    { key: "customerTier", label: "Customer tier", value: 80, weight: 10, evidence: "Enterprise and Growth accounts affected" },
    { key: "strategicAlignment", label: "Strategic alignment", value: 76, weight: 5, evidence: "Supports trusted reporting workflow" },
    { key: "sla", label: "SLA", value: 68, weight: 5, evidence: "Customer response window is active" },
    { key: "engineeringEffort", label: "Effort", value: effort, weight: 5, evidence: `${effort}/100 estimated engineering effort` },
  ];
}

const problems = [
  {
    id: "prob_demo_export",
    title: "Large CSV exports produce empty files",
    statement: "Customers exporting datasets above approximately 10,000 rows receive an empty or zero-byte CSV despite a successful completion state.",
    summary: "Three enterprise customers reported the same failure after release 4.18.2. Small exports remain healthy, indicating a size-dependent regression in asynchronous export finalization.",
    stage: "Needs review",
    severity: "High",
    confidence: 0.92,
    productArea: "Analytics exports",
    team: "Data Experience",
    churnRisk: 72,
    repository: "northstar/analytics-api",
    files: ["services/exports/finalize.ts", "workers/csv-export.ts", "lib/object-storage.ts"],
    factors: impactFactors(76, 88, 92, 72, 34),
  },
  {
    id: "prob_demo_sso",
    title: "SSO sessions expire during onboarding",
    statement: "New enterprise administrators are returned to the sign-in screen while configuring SAML, losing the setup state they already entered.",
    summary: "Six reports across support and chat point to a short-lived setup session that interrupts first-time SSO configuration.",
    stage: "Detected",
    severity: "High",
    confidence: 0.87,
    productArea: "Identity & access",
    team: "Platform",
    churnRisk: 64,
    repository: "northstar/identity-service",
    files: ["auth/saml/setup-session.ts", "web/onboarding/sso.tsx"],
    factors: impactFactors(82, 84, 74, 64, 48),
  },
  {
    id: "prob_demo_billing",
    title: "Usage alerts arrive after customers exceed plan limits",
    statement: "Workspace owners receive usage notifications only after an overage has already occurred, preventing proactive cost control.",
    summary: "Five accounts asked for earlier warnings at configurable thresholds before monthly limits are crossed.",
    stage: "Approved",
    severity: "High",
    confidence: 0.84,
    productArea: "Billing & plans",
    team: "Monetization",
    churnRisk: 59,
    repository: "northstar/billing-service",
    files: ["usage/threshold-monitor.ts", "notifications/overage.ts"],
    factors: impactFactors(70, 78, 86, 59, 42),
  },
  {
    id: "prob_demo_mobile",
    title: "Mobile dashboard freezes when filters are changed",
    statement: "The mobile dashboard becomes unresponsive after two or more filter changes, requiring the application to be restarted.",
    summary: "Five mobile reports show a repeatable freeze on iOS and Android when dashboard filter state is recomputed.",
    stage: "Planned",
    severity: "Medium",
    confidence: 0.79,
    productArea: "Mobile experience",
    team: "Mobile",
    churnRisk: 42,
    repository: "northstar/mobile-app",
    files: ["screens/dashboard/filters.tsx", "state/dashboard-query.ts"],
    factors: impactFactors(65, 66, 54, 42, 55),
  },
  {
    id: "prob_demo_permissions",
    title: "Role permissions are difficult to audit",
    statement: "Administrators cannot quickly explain which inherited permissions allow a user to access sensitive workspace data.",
    summary: "Security teams need an exportable effective-permissions view before quarterly access reviews.",
    stage: "In progress",
    severity: "Medium",
    confidence: 0.82,
    productArea: "Administration",
    team: "Security",
    churnRisk: 48,
    repository: "northstar/admin-console",
    files: ["permissions/effective-access.ts", "pages/security/roles.tsx"],
    factors: impactFactors(58, 72, 76, 48, 63),
  },
  {
    id: "prob_demo_notifications",
    title: "Notification digests ignore workspace timezone",
    statement: "Daily summaries are delivered using UTC instead of the workspace timezone, often reaching operators outside working hours.",
    summary: "Four teams across three regions report that digest delivery is misaligned with their configured timezone.",
    stage: "Released",
    severity: "Medium",
    confidence: 0.76,
    productArea: "Notifications",
    team: "Engagement",
    churnRisk: 36,
    repository: "northstar/notification-service",
    files: ["digests/scheduler.ts", "workspaces/timezone.ts"],
    factors: impactFactors(61, 52, 48, 36, 28),
  },
  {
    id: "prob_demo_import",
    title: "Salesforce CSV imports duplicate contacts",
    statement: "Re-importing an updated Salesforce export creates duplicate contacts when email casing differs from the original record.",
    summary: "Four customer operations teams reproduced the duplicate-contact behavior during recurring account updates.",
    stage: "Verified",
    severity: "High",
    confidence: 0.88,
    productArea: "Data import",
    team: "Integrations",
    churnRisk: 51,
    repository: "northstar/import-worker",
    files: ["normalizers/contact-email.ts", "jobs/salesforce-import.ts"],
    factors: impactFactors(64, 79, 62, 51, 38),
  },
  {
    id: "prob_demo_search",
    title: "Global search misses archived projects",
    statement: "Archived projects do not appear in global search even when the user explicitly enables archived content.",
    summary: "Four teams previously reported missing historical results; the released index fix is now verified.",
    stage: "Closed",
    severity: "Low",
    confidence: 0.9,
    productArea: "Navigation",
    team: "Core Product",
    churnRisk: 21,
    repository: "northstar/search-service",
    files: ["indexers/projects.ts", "queries/global-search.ts"],
    factors: impactFactors(49, 34, 38, 21, 22),
  },
];

const feedbackSpecs = [
  ["prob_demo_export", "Zendesk", "acct_demo_acme", "Bug", "High", 0, 0, "Edge 126 · Windows 11 · v4.18.2", "Our quarterly export reports success, then downloads a zero-byte CSV once the dataset passes 10,000 rows."],
  ["prob_demo_export", "Intercom", "acct_demo_atlas", "Bug", "High", 0, 1, "Chrome 126 · macOS · v4.18.2", "Large exports finish but the downloaded file is blank. Small exports from the same report still work."],
  ["prob_demo_export", "Slack", "acct_demo_meridian", "Bug", "High", 0, 1, "Chrome 125 · macOS · v4.18.2", "We reproduced another empty CSV on the monthly analytics export after yesterday's release."],

  ["prob_demo_sso", "Zendesk", "acct_demo_hightower", "Incident", "High", 0, 0, "Chrome 126 · Windows 11 · SAML setup", "The SAML setup wizard signed me out before I could save the certificate and I had to restart."],
  ["prob_demo_sso", "Intercom", "acct_demo_lumon", "Bug", "High", 1, 0, "Safari 18 · macOS · SAML setup", "Our admin session expires every time we reach the domain verification step."],
  ["prob_demo_sso", "Slack", "acct_demo_orbit", "Usability", "Medium", 1, 3, "Chrome 125 · macOS · SAML setup", "SSO onboarding lost all of the values we entered when the session timed out."],
  ["prob_demo_sso", "Email", "acct_demo_hightower", "Bug", "High", 2, 2, "Edge 125 · Windows 11 · SAML setup", "We cannot finish SSO because the configuration page returns us to login after a few minutes."],
  ["prob_demo_sso", "Zendesk", "acct_demo_lumon", "Question", "Medium", 3, 1, "Chrome 124 · macOS · SAML setup", "Is there a way to extend the admin session while we coordinate our SAML settings?"],
  ["prob_demo_sso", "Survey", "acct_demo_orbit", "Usability", "Medium", 5, 4, "Web · enterprise onboarding", "SSO setup should preserve progress when a security administrator needs to sign in again."],

  ["prob_demo_billing", "Intercom", "acct_demo_acme", "Feature request", "High", 0, 0, "Web · usage dashboard", "Please warn us at 80 and 90 percent instead of notifying us only after the overage."],
  ["prob_demo_billing", "Zendesk", "acct_demo_hightower", "Incident", "High", 1, 2, "Web · billing alerts", "The first budget alert arrived six hours after our workspace had exceeded its monthly limit."],
  ["prob_demo_billing", "Email", "acct_demo_nova", "Feature request", "Medium", 2, 4, "Email notification · Growth plan", "We need configurable usage thresholds so finance can intervene before additional charges accrue."],
  ["prob_demo_billing", "Survey", "acct_demo_acme", "Usability", "Medium", 4, 1, "Web · billing settings", "The current usage alert is retrospective, which makes it hard to manage spend."],
  ["prob_demo_billing", "Slack", "acct_demo_nova", "Question", "Medium", 6, 3, "Slack · customer-success channel", "Can usage warnings be delivered before we cross the plan limit?"],

  ["prob_demo_mobile", "Intercom", "acct_demo_willow", "Bug", "Medium", 0, 1, "iOS 19 · app 4.18.2", "Changing the account and date filters back-to-back freezes the dashboard until I force quit."],
  ["prob_demo_mobile", "Zendesk", "acct_demo_starlight", "Bug", "Medium", 1, 4, "Android 16 · app 4.18.1", "The mobile dashboard stops responding after the second filter change."],
  ["prob_demo_mobile", "Survey", "acct_demo_atlas", "Usability", "Medium", 2, 1, "iOS 19 · app 4.17.9", "Filtering on mobile is unreliable and I often have to restart the application."],
  ["prob_demo_mobile", "Slack", "acct_demo_willow", "Bug", "Medium", 3, 4, "Android 15 · app 4.17.8", "Dashboard controls locked up again while switching from weekly to monthly view."],
  ["prob_demo_mobile", "Email", "acct_demo_starlight", "Bug", "Low", 7, 2, "iOS 18 · app 4.16.7", "The mobile analytics screen occasionally hangs when multiple filters are active."],

  ["prob_demo_permissions", "Zendesk", "acct_demo_meridian", "Feature request", "Medium", 0, 0, "Admin console · roles", "We need to show auditors exactly why each user can access a restricted workspace."],
  ["prob_demo_permissions", "Email", "acct_demo_cascade", "Question", "Medium", 1, 1, "Admin console · permissions", "How can we export effective permissions including access inherited from groups?"],
  ["prob_demo_permissions", "Intercom", "acct_demo_hightower", "Usability", "Medium", 4, 2, "Admin console · roles", "The role page lists grants but not the inherited path that produced them."],
  ["prob_demo_permissions", "Survey", "acct_demo_cascade", "Feature request", "Medium", 5, 3, "Quarterly access review", "An audit-ready permissions report would save our security team several days each quarter."],

  ["prob_demo_notifications", "Slack", "acct_demo_orbit", "Bug", "Medium", 0, 1, "Workspace timezone · America/New_York", "Our daily digest still arrives at 3 AM even though the workspace timezone is set to New York."],
  ["prob_demo_notifications", "Zendesk", "acct_demo_mosaic", "Bug", "Medium", 2, 3, "Workspace timezone · Europe/London", "The digest schedule appears to use UTC rather than our configured London timezone."],
  ["prob_demo_notifications", "Intercom", "acct_demo_pioneer", "Usability", "Low", 3, 2, "Workspace timezone · Asia/Singapore", "Daily summaries arrive after our team has ended the workday."],
  ["prob_demo_notifications", "Survey", "acct_demo_orbit", "Question", "Low", 6, 1, "Notification settings", "Which timezone controls the delivery time for daily summaries?"],

  ["prob_demo_import", "Zendesk", "acct_demo_lumon", "Bug", "High", 1, 2, "Salesforce CSV import · v4.18.0", "The weekly Salesforce import created duplicate contacts when email capitalization changed."],
  ["prob_demo_import", "Email", "acct_demo_nova", "Incident", "High", 2, 0, "Salesforce CSV import · v4.17.9", "Re-importing our account export added 247 duplicate contacts instead of updating them."],
  ["prob_demo_import", "Slack", "acct_demo_cascade", "Bug", "Medium", 4, 4, "Salesforce CSV import · v4.17.7", "Contact deduplication treats uppercase and lowercase email addresses as different people."],
  ["prob_demo_import", "Intercom", "acct_demo_lumon", "Bug", "Medium", 7, 4, "Salesforce CSV import · v4.16.9", "Our recurring Salesforce upload is duplicating contacts that already exist."],

  ["prob_demo_search", "Intercom", "acct_demo_willow", "Bug", "Low", 0, 0, "Global search · v4.18.2", "Archived projects now appear in search after enabling the archived-content filter."],
  ["prob_demo_search", "Zendesk", "acct_demo_pioneer", "Bug", "Medium", 1, 4, "Global search · v4.18.0", "The archived project filter is enabled but older projects still do not appear in results."],
  ["prob_demo_search", "Slack", "acct_demo_starlight", "Usability", "Low", 3, 3, "Global search · v4.17.8", "We can open archived projects by URL, but global search cannot find them."],
  ["prob_demo_search", "Survey", "acct_demo_willow", "Question", "Low", 5, 1, "Global search · v4.17.3", "Should archived projects be included when the search filter is enabled?"],

  [null, "Email", "acct_demo_mosaic", "Feature request", "Low", 2, 4, "Weekly operations email", "Could the dashboard email a compact Monday summary of new customer feedback and decisions?"],
  [null, "Survey", "acct_demo_pioneer", "Usability", "Low", 3, 4, "Web · navigation", "I expected the team switcher to remember the last workspace I opened."],
  [null, "Intercom", "acct_demo_nova", "Question", "Low", 4, 3, "Web · exports", "Can an exported report include the exact filter definition used to generate it?"],
  [null, "Slack", "acct_demo_cascade", "Feature request", "Medium", 5, 2, "Slack · customer-success channel", "It would help to tag feedback that comes from a renewal call separately from general comments."],
  [null, "Zendesk", "acct_demo_starlight", "Usability", "Low", 6, 4, "Web · profile settings", "The profile save confirmation disappears before I can tell whether the update worked."],
];

const feedback = feedbackSpecs.map((spec, index) => {
  const [problemId, source, accountId, type, severity, weeksAgo, dayOffset, environment, quote] = spec;
  const account = accountById.get(accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const observedAt = eventDate(weeksAgo, dayOffset, index);
  return {
    id: `fb_demo_${String(index + 1).padStart(3, "0")}`,
    problemId,
    source,
    accountId,
    customer: account.name,
    tier: account.tier,
    arr: account.arr,
    type,
    severity,
    weeksAgo,
    redacted: true,
    environment,
    confidence: problemId ? Math.max(0.74, 0.95 - (index % 7) * 0.025) : 0.68,
    observedAt,
    quote,
  };
});

const investigations = [
  {
    id: "inv_demo_export",
    problemId: "prob_demo_export",
    title: "Trace large-export finalization regression",
    status: "Ready for approval",
    hypothesis: "The asynchronous finalizer marks multipart exports complete before object storage commits the final CSV for datasets above the in-memory threshold.",
    confidence: 0.68,
    assumptions: ["Reports use the asynchronous export path", "All three customers are on release 4.18.2"],
    missing: ["Worker trace from a failing export", "Object-storage commit timing at the 10k-row boundary"],
    action: "Create a scoped GitHub issue with redacted evidence, suspected files, and a regression-test checklist. No code or deployment will run without human approval.",
    tests: ["Reproduce at 9,999, 10,000, and 10,001 rows", "Assert final object size before completion event", "Replay a multipart upload under worker retry"],
    files: ["services/exports/finalize.ts", "workers/csv-export.ts", "lib/object-storage.ts"],
  },
  {
    id: "inv_demo_sso",
    problemId: "prob_demo_sso",
    title: "Compare SAML setup and session TTLs",
    status: "Gathering evidence",
    hypothesis: "The setup wizard inherits the normal admin session TTL instead of the longer onboarding transaction TTL.",
    confidence: 0.61,
    assumptions: ["Timeouts occur during an otherwise valid SAML setup"],
    missing: ["Session-expiry logs", "Median time spent on domain verification"],
    action: "Collect session-expiry telemetry before proposing an implementation change.",
    tests: ["Pause setup beyond the admin TTL", "Resume setup after reauthentication"],
    files: ["auth/saml/setup-session.ts", "web/onboarding/sso.tsx"],
  },
  {
    id: "inv_demo_billing",
    problemId: "prob_demo_billing",
    title: "Audit usage-threshold evaluation cadence",
    status: "Ready for review",
    hypothesis: "Threshold evaluation runs only after ledger settlement instead of on near-real-time usage events.",
    confidence: 0.73,
    assumptions: ["Usage events are available before settlement"],
    missing: ["Notification queue latency by plan"],
    action: "Validate event timing and draft configurable pre-overage thresholds.",
    tests: ["Emit 79%, 80%, and 90% usage events", "Measure alert latency before settlement"],
    files: ["usage/threshold-monitor.ts", "notifications/overage.ts"],
  },
  {
    id: "inv_demo_mobile",
    problemId: "prob_demo_mobile",
    title: "Profile dashboard filter recomputation",
    status: "Monitoring",
    hypothesis: "A stale query subscription recursively recomputes dashboard state after consecutive filter changes.",
    confidence: 0.58,
    assumptions: ["The freeze is client-side"],
    missing: ["Mobile performance trace", "Device memory profile"],
    action: "Capture performance traces from two affected device classes.",
    tests: ["Change filters ten times in succession", "Profile subscription teardown"],
    files: ["screens/dashboard/filters.tsx", "state/dashboard-query.ts"],
  },
  {
    id: "inv_demo_import",
    problemId: "prob_demo_import",
    title: "Validate case-insensitive contact deduplication",
    status: "Verification",
    hypothesis: "Email normalization happens after the contact identity lookup, allowing case-only variants to bypass deduplication.",
    confidence: 0.86,
    assumptions: ["Email is the configured contact identity key"],
    missing: ["One post-release production import sample"],
    action: "Verify the released normalizer against a redacted recurring import.",
    tests: ["Import mixed-case email variants", "Re-run an unchanged export"],
    files: ["normalizers/contact-email.ts", "jobs/salesforce-import.ts"],
  },
];

const integrations = [
  ["int_webhook", "Custom webhook", "Custom", "Demo connected", 0, "Email, survey, and in-product feedback · read only", ["feedback:write", "delivery:read"]],
  ["int_zendesk", "Zendesk", "Feedback", "Demo connected", 1, "Tickets, comments, tags, and organization references", ["tickets:read", "users:read", "organizations:read"]],
  ["int_intercom", "Intercom", "Feedback", "Demo connected", 2, "Conversations, contacts, and conversation tags", ["conversations:read", "contacts:read"]],
  ["int_slack", "Slack", "Feedback", "Demo connected", 3, "Selected customer-success channels · messages only", ["channels:read", "messages:read"]],
  ["int_app_store", "Apple App Store", "Reviews", "Not connected", 4, "None", []],
  ["int_play_store", "Google Play Store", "Reviews", "Not connected", 5, "None", []],
  ["int_jira", "Jira", "Engineering", "Not connected", 6, "None", []],
  ["int_linear", "Linear", "Engineering", "Not connected", 7, "None", []],
  ["int_github", "GitHub", "Engineering", "Demo configured", 8, "Repository metadata and simulated issue creation after approval", ["metadata:read", "issues:write"]],
  ["int_sentry", "Sentry", "Observability", "Not connected", 11, "None", []],
  ["int_posthog", "PostHog", "Analytics", "Not connected", 13, "None", []],
];

const guideSteps = [
  { id: "operating-picture", title: "Start with the operating picture", description: "Show how one workspace turns fragmented signals into an executive view of volume, urgency, revenue, and resolution speed.", path: "/overview", actionLabel: "Open overview", talkingPoints: ["40 signals across five feedback channels", "Five items still await human-reviewed clustering", "Revenue and renewal risk determine what rises first"] },
  { id: "raw-signals", title: "Inspect the raw customer evidence", description: "Open a feedback record to demonstrate source context, PII-safe content, AI classification, confidence, and the reviewed destination problem.", path: "/feedback", actionLabel: "Open feedback inbox", talkingPoints: ["Every signal retains source and account context", "PII protection is visible, not hidden", "AI recommendations remain reviewable"] },
  { id: "problem-map", title: "See the problem map", description: "Show how repeated reports become durable product problems instead of a pile of disconnected tickets.", path: "/problems", actionLabel: "Open product problems", talkingPoints: ["Eight evidence-backed problem clusters", "Stages separate detection, delivery, and verification", "Themes emerge from reviewed links"] },
  { id: "priority", title: "Prioritize by business impact", description: "Compare frequency, severity, affected ARR, churn risk, confidence, and effort in one decision surface.", path: "/prioritization", actionLabel: "Open prioritization", talkingPoints: ["The export regression leads because evidence and ARR align", "Weights express the operating policy", "Every score traces back to customer evidence"] },
  { id: "evidence", title: "Review the highest-impact problem", description: "Open the large-export regression and connect three corroborating customer reports to release 4.18.2 and the suspected repository surface.", path: "/problems/prob_demo_export", actionLabel: "Review problem evidence", talkingPoints: ["Three enterprise reports describe the same failure mode", "$550k ARR is visibly represented", "Technical causes remain hypotheses until verified"] },
  { id: "investigation", title: "Inspect the agent investigation", description: "Show the proposed root-cause hypothesis, evidence gaps, suspected files, and tests prepared by the Operations Manager agent.", path: "/investigations", actionLabel: "Open investigation", talkingPoints: ["The agent distinguishes facts from assumptions", "Missing evidence is explicit", "Recommended tests make the next step actionable"] },
  { id: "approval", title: "Keep a human at the action boundary", description: "Approve the simulated GitHub issue after reviewing risk, shared data, reversibility, and confidence.", path: "/approvals", actionLabel: "Review approval", talkingPoints: ["No external action happens before approval", "The issue payload uses redacted evidence", "The audit trail records the decision"] },
  { id: "lifecycle", title: "Drive the fix through verification", description: "Return to the problem and advance Approved → Planned → In progress → Released → Verified to demonstrate closed-loop execution.", path: "/problems/prob_demo_export", actionLabel: "Advance the lifecycle", talkingPoints: ["Operations retains one shared state across teams", "Verification, not release, is the finish line", "Verified status unlocks customer follow-up"] },
  { id: "follow-up", title: "Close the loop with customers", description: "Review the customer-ready drafts created only after verification, then approve the simulated follow-up batch.", path: "/follow-up", actionLabel: "Open customer follow-up", talkingPoints: ["Only affected customers receive a draft", "Sensitive details are excluded", "Delivery remains simulated in this demo"] },
  { id: "connectors", title: "Show the feedback network", description: "Explain how authenticated and webhook sources feed the workspace while GitHub receives only approved actions.", path: "/integrations", actionLabel: "Open integrations", talkingPoints: ["Demo connections are labeled and make no external request", "Each connector exposes scope and permissions", "The copilot guides setup without blocking progress"] },
  { id: "customers", title: "Connect product work to customer value", description: "Show how signals, open problems, ARR, tier, and churn risk stay attached to the accounts behind the feedback.", path: "/customers", actionLabel: "Open customers", talkingPoints: ["Twelve accounts provide realistic portfolio context", "Problems roll up to affected revenue", "Operators can defend why work matters"] },
  { id: "governance", title: "Finish with trust and control", description: "Close the presentation with autonomy boundaries, PII policy, prioritization weights, prompt versioning, model-run history, budget, and the single workspace owner.", path: "/settings", actionLabel: "Open governance", talkingPoints: ["Your Google login is the only Demo member", "AI actions are observe-and-recommend by policy", "Reset walkthrough data makes the presentation repeatable"] },
];

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id,name,created_at FROM organizations WHERE id=$1 FOR UPDATE",
      [orgId],
    );
    if (!existing.rowCount) throw new Error(`Organization ${orgId} does not exist`);
    const orgName = existing.rows[0].name;
    const organizationCreatedAt = existing.rows[0].created_at;
    if (!/demo/i.test(orgName)) {
      throw new Error(`Refusing to replace organization \"${orgName}\" because its name does not contain Demo`);
    }

    await client.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await client.query(
      "INSERT INTO organizations(id,name,created_at,updated_at) VALUES($1,$2,$3,now())",
      [orgId, orgName, organizationCreatedAt],
    );

    const memberId = `user_${createHash("sha256").update(ownerEmail).digest("hex").slice(0, 20)}`;
    const displayName = ownerEmail === "shanmukhsain@gmail.com" ? "Shanmukh Sain" : ownerEmail.split("@")[0];
    await client.query(
      `INSERT INTO workspace_members(id,org_id,display_name,email,role,team)
       VALUES($1,$2,$3,$4,'Admin','Owners')`,
      [memberId, orgId, displayName, ownerEmail],
    );
    await client.query(
      `INSERT INTO workspaces(id,org_id,name,primary_problem_id,primary_approval_id,version)
       VALUES($1,$2,'Northstar Analytics · guided demo','prob_demo_export','apr_demo_export',1)`,
      [`${orgId}_demo_workspace`, orgId],
    );
    await client.query(
      `INSERT INTO workspace_settings(
         org_id,autonomy_level,pii_redaction,retention_days,priority_weights,
         monthly_model_budget,used_model_cost,hard_stop,plan_name,plan_price
       ) VALUES(
         $1,'Recommend',true,365,$2::jsonb,500,37,true,'Growth demo','$499 / month'
       )`,
      [orgId, JSON.stringify({ frequency: 20, severity: 20, revenue: 20, churnRisk: 15, customerTier: 10, strategicAlignment: 5, sla: 5, engineeringEffort: 5 })],
    );
    await client.query(
      `INSERT INTO workspace_onboarding(org_id,phase,product_profile,recommended_connectors,messages)
       VALUES($1,'complete',$2::jsonb,$3::jsonb,$4::jsonb)`,
      [
        orgId,
        JSON.stringify({ productName: "Northstar Analytics", productUrl: "https://northstar.example", description: "B2B analytics and reporting platform used by operations teams to monitor customer and business performance.", market: "B2B SaaS", primaryUsers: ["Operations leaders", "Customer success", "Product managers"] }),
        JSON.stringify([{ integrationId: "int_zendesk", priority: "required", reason: "Primary support ticket source" }, { integrationId: "int_intercom", priority: "recommended", reason: "In-product conversations" }, { integrationId: "int_slack", priority: "recommended", reason: "Customer-success escalation channel" }, { integrationId: "int_github", priority: "required", reason: "Approved engineering action destination" }]),
        JSON.stringify([{ role: "assistant", content: "I understand Northstar Analytics. I found support, chat, customer-success, and engineering surfaces and prepared a least-privilege connection plan." }, { role: "assistant", content: "The Demo workspace is fully populated. Use Guided demo to present the complete feedback-to-resolution workflow." }]),
      ],
    );

    for (const [id, name, arr, tier, customerSince, churnRisk] of accounts) {
      await client.query(
        `INSERT INTO accounts(id,org_id,name,arr,tier,customer_since,churn_risk)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, orgId, name, arr, tier, customerSince, churnRisk],
      );
    }

    for (const problem of problems) {
      await client.query(
        `INSERT INTO product_problems(
           id,org_id,title,statement,summary,stage,severity,confidence,product_area,
           team,churn_risk,suspected_repository,suspected_files,impact_factors
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,
        [problem.id, orgId, problem.title, problem.statement, problem.summary, problem.stage, problem.severity, problem.confidence, problem.productArea, problem.team, problem.churnRisk, problem.repository, JSON.stringify(problem.files), JSON.stringify(problem.factors)],
      );
    }

    for (const item of feedback) {
      await client.query(
        `INSERT INTO feedback_items(
           id,org_id,source,customer_name,account_tier,arr,type,severity,redacted,
           environment,confidence,observed_at,quote,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [item.id, orgId, item.source, item.customer, item.tier, item.arr, item.type, item.severity, item.redacted, item.environment, item.confidence, item.observedAt.toISOString(), item.quote, item.observedAt],
      );
      if (item.problemId) {
        const problem = problems.find((candidate) => candidate.id === item.problemId);
        const similarity = Math.max(0.72, Math.min(0.96, item.confidence - 0.02));
        await client.query(
          `INSERT INTO feedback_cluster_memberships(org_id,problem_id,feedback_id,similarity,explanation,created_at)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [orgId, item.problemId, item.id, similarity, `Reviewed match: ${problem?.title ?? item.problemId}`, item.observedAt],
        );
      }
    }

    for (const problem of problems) {
      const members = feedback.filter((item) => item.problemId === problem.id);
      const current = members.filter((item) => item.observedAt >= currentWeekStart).length;
      const previousStart = new Date(currentWeekStart.getTime() - 7 * DAY);
      const previous = members.filter((item) => item.observedAt >= previousStart && item.observedAt < currentWeekStart).length;
      await client.query(
        `INSERT INTO problem_period_metrics(org_id,problem_id,current_signals,previous_signals,period_days)
         VALUES($1,$2,$3,$4,7)`,
        [orgId, problem.id, current, previous],
      );
      for (const item of members.slice(0, 3)) {
        await client.query(
          `INSERT INTO problem_confidence_evidence(org_id,problem_id,evidence_id,confidence)
           VALUES($1,$2,$3,$4)`,
          [orgId, problem.id, item.id, Math.max(0.7, item.confidence - 0.01)],
        );
      }
      const impactedAccountIds = [...new Set(members.map((item) => item.accountId))];
      for (const accountId of impactedAccountIds) {
        await client.query(
          "INSERT INTO problem_account_impacts(org_id,problem_id,account_id) VALUES($1,$2,$3)",
          [orgId, problem.id, accountId],
        );
      }
    }

    const weeklyCounts = new Map();
    for (const item of feedback) {
      const weekIndex = 8 - item.weeksAgo;
      const key = `${item.source}:${weekIndex}`;
      weeklyCounts.set(key, (weeklyCounts.get(key) ?? 0) + 1);
    }
    for (const [key, signalCount] of weeklyCounts) {
      const separator = key.lastIndexOf(":");
      const source = key.slice(0, separator);
      const weekIndex = Number(key.slice(separator + 1));
      if (weekIndex >= 1 && weekIndex <= 8) {
        await client.query(
          "INSERT INTO weekly_signal_metrics(org_id,source,week_index,signal_count) VALUES($1,$2,$3,$4)",
          [orgId, source, weekIndex, signalCount],
        );
      }
    }

    const rankedThemes = problems
      .map((problem) => {
        const members = feedback.filter((item) => item.problemId === problem.id);
        const previousStart = new Date(currentWeekStart.getTime() - 7 * DAY);
        return {
          theme: problem.productArea,
          current: members.filter((item) => item.observedAt >= currentWeekStart).length,
          previous: members.filter((item) => item.observedAt >= previousStart && item.observedAt < currentWeekStart).length,
        };
      })
      .sort((left, right) => right.current - left.current || right.previous - left.previous);
    for (const [index, theme] of rankedThemes.entries()) {
      await client.query(
        `INSERT INTO theme_period_metrics(org_id,theme,current_signals,previous_signals,rank)
         VALUES($1,$2,$3,$4,$5)`,
        [orgId, theme.theme, theme.current, theme.previous, index + 1],
      );
    }

    for (const [comparison, values] of [["current", [2.4, 3.1, 4.0]], ["previous", [6.8, 7.3, 5.9]]]) {
      for (const duration of values) {
        await client.query(
          "INSERT INTO resolution_samples(id,org_id,comparison_period,duration_days) VALUES($1,$2,$3,$4)",
          [randomUUID(), orgId, comparison, duration],
        );
      }
    }

    for (const investigation of investigations) {
      await client.query(
        `INSERT INTO investigations(
           id,org_id,problem_id,title,status,hypothesis,confidence,assumptions,
           missing_information,proposed_action,recommended_tests,suspected_files
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb)`,
        [investigation.id, orgId, investigation.problemId, investigation.title, investigation.status, investigation.hypothesis, investigation.confidence, JSON.stringify(investigation.assumptions), JSON.stringify(investigation.missing), investigation.action, JSON.stringify(investigation.tests), JSON.stringify(investigation.files)],
      );
    }

    await client.query(
      `INSERT INTO approval_requests(
         id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,
         data_shared,reversible,risk,status
       ) VALUES(
         'apr_demo_export',$1,'prob_demo_export','inv_demo_export',
         'Create GitHub issue in northstar/analytics-api',
         'Three corroborating enterprise reports identify a release-linked regression affecting $550k ARR.',
         0.68,'["GitHub (simulated demo)"]'::jsonb,
         '["Redacted customer quotes","Environment metadata","Suspected repository paths","Regression-test checklist"]'::jsonb,
         true,'Low','Pending'
       )`,
      [orgId],
    );

    for (const [id, provider, category, state, order, scope, permissions] of integrations) {
      const connected = state.startsWith("Demo");
      await client.query(
        `INSERT INTO integrations(
           id,org_id,provider,category,connection_state,last_sync_at,data_scope,
           permissions,error_message,display_order
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL,$9)`,
        [id, orgId, provider, category, state, connected ? new Date(now.getTime() - (order + 3) * 60 * 1_000) : null, scope, JSON.stringify(permissions), order],
      );
    }

    const modelRunId = randomUUID();
    const analyzedFeedback = feedback.filter((item) => item.problemId);
    await client.query(
      `INSERT INTO model_runs(
         id,org_id,prompt_version_id,provider,model,status,idempotency_key,
         input_record_ids,output,external_response_id,input_tokens,output_tokens,
         started_at,completed_at
       ) VALUES($1,$2,'prompt_feedback_intelligence_v1','xai','grok-4.5','Succeeded',
         'demo-seed-analysis-v1',$3::jsonb,$4::jsonb,'demo-model-run',4820,2190,$5,$6)`,
      [modelRunId, orgId, JSON.stringify(analyzedFeedback.map((item) => item.id)), JSON.stringify({ analyzed: analyzedFeedback.length, proposedClusters: problems.length, message: "Demo analysis completed with human-reviewed cluster links." }), new Date(now.getTime() - 25 * 60 * 1_000), new Date(now.getTime() - 24 * 60 * 1_000)],
    );
    for (const item of analyzedFeedback) {
      const problem = problems.find((candidate) => candidate.id === item.problemId);
      const classification = item.type === "Incident" ? "Incident" : item.type;
      await client.query(
        `INSERT INTO ai_feedback_analyses(
           id,org_id,model_run_id,feedback_id,classification,severity,redacted_summary,
           proposed_problem_id,classification_confidence,cluster_confidence,
           confidence_factors,rationale,evidence,review_status,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,'Approved',$14)`,
        [randomUUID(), orgId, modelRunId, item.id, classification, item.severity, item.quote, item.problemId, item.confidence, Math.max(0.72, item.confidence - 0.03), JSON.stringify({ evidenceQuality: 0.9, classificationClarity: item.confidence, clusterMatch: Math.max(0.72, item.confidence - 0.03), ambiguityPenalty: 0.08 }), `Human-reviewed match to ${problem?.title ?? item.problemId}.`, JSON.stringify([`Source: ${item.source}`, `Environment: ${item.environment}`, "Customer content was treated as untrusted evidence."]), new Date(now.getTime() - 23 * 60 * 1_000)],
      );
    }

    const auditSeed = [
      ["agent_ingestion", "Ingestion agent", "Imported 40 feedback signals across five sources", "ProductProblem", "prob_demo_export"],
      ["agent_redaction", "Privacy agent", "Scanned imported feedback and applied PII-safe presentation", "ProductProblem", "prob_demo_export"],
      ["agent_classification", "Classification agent", "Classified 35 signals and left 5 awaiting analysis", "ProductProblem", "prob_demo_export"],
      ["agent_clustering", "Clustering agent", "Proposed eight evidence-backed product problem clusters", "ProductProblem", "prob_demo_export"],
      ["ops_reviewer", "Operations reviewer", "Reviewed cluster links and prioritized the export regression", "ProductProblem", "prob_demo_export"],
      ["agent_investigation", "Investigation agent", "Prepared a code-aware recommendation with explicit evidence gaps", "ApprovalRequest", "apr_demo_export"],
    ];
    for (const [index, [actorId, actorName, action, entityType, entityId]] of auditSeed.entries()) {
      await client.query(
        `INSERT INTO audit_events(
           id,org_id,occurred_at,actor_id,actor_name,action,entity_type,entity_id,trace_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), orgId, new Date(now.getTime() - (45 - index * 4) * 60 * 1_000), actorId, actorName, action, entityType, entityId, `demo-seed-${String(index + 1).padStart(3, "0")}`],
      );
    }

    await client.query(
      `INSERT INTO workspace_demo_guides(org_id,title,description,steps,enabled)
       VALUES($1,'From fragmented feedback to verified resolution',
         'A repeatable 12-step product story for an Operations Manager presenting CloseSpan.',
         $2::jsonb,true)`,
      [orgId, JSON.stringify(guideSteps)],
    );

    const verification = await client.query(
      `SELECT
         (SELECT count(*)::int FROM workspace_members WHERE org_id=$1) AS members,
         (SELECT count(*)::int FROM feedback_items WHERE org_id=$1) AS feedback,
         (SELECT count(*)::int FROM product_problems WHERE org_id=$1) AS problems,
         (SELECT count(*)::int FROM accounts WHERE org_id=$1) AS accounts,
         (SELECT count(*)::int FROM feedback_items f WHERE f.org_id=$1 AND NOT EXISTS (
           SELECT 1 FROM feedback_cluster_memberships m WHERE m.org_id=f.org_id AND m.feedback_id=f.id
         )) AS awaiting_analysis,
         (SELECT count(*)::int FROM investigations WHERE org_id=$1) AS investigations,
         (SELECT count(*)::int FROM approval_requests WHERE org_id=$1 AND status='Pending') AS pending_approvals,
         (SELECT count(*)::int FROM workspace_demo_guides WHERE org_id=$1 AND enabled=true) AS guides,
         (SELECT count(*)::int FROM pipedream_connections WHERE org_id=$1) AS external_connections`,
      [orgId],
    );
    const counts = verification.rows[0];
    if (
      counts.members !== 1 || counts.feedback !== 40 || counts.problems !== 8 ||
      counts.accounts !== 12 || counts.awaiting_analysis !== 5 ||
      counts.investigations !== 5 || counts.pending_approvals !== 1 ||
      counts.guides !== 1 || counts.external_connections !== 0
    ) {
      throw new Error(`Demo verification failed: ${JSON.stringify(counts)}`);
    }

    await client.query("COMMIT");
    console.log("Provisioned private guided demo", {
      orgId,
      organization: orgName,
      ownerEmail,
      ...counts,
      guideSteps: guideSteps.length,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
