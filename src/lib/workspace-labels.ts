/**
 * Canonical screen names shared by navigation, page headings, and tool links.
 * An issue groups customer reports; a prompt prepares work; an agent run
 * implements it. Action approvals are decisions, not successful test results.
 * Keep these display terms separate from persisted workflow/status values.
 */
export const WORKSPACE_LABELS = {
  overview: "Overview",
  customers: "Customers",
  feedback: "Feedback inbox",
  problems: "Issues",
  pdd: "Prompt Testing",
  approvals: "Action approvals",
  "agent-runs": "Agent activity",
  "follow-up": "Follow-up",
  integrations: "Integrations",
  settings: "Settings",
} as const;
