export const SITE_URL = "https://www.closespan.com";
export const SITE_NAME = "CloseSpan";
export const SITE_TITLE =
  "CloseSpan | Customer Calls to Clear Product Issues";
export const SITE_DESCRIPTION =
  "A customer-success workflow from call summaries to clear product issues and test previews. In development with design-partner pilots for B2B SaaS teams.";

export const PUBLIC_EMAILS = {
  hello: "hello@closespan.com",
  support: "support@closespan.com",
  security: "security@closespan.com",
  privacy: "privacy@closespan.com",
} as const;

export const SITE_ALTERNATE_NAMES = [
  "CloseSpan AI",
  "closespan.com",
] as const;

export const PUBLIC_INDEXABLE_PATHS = [
  "/",
  "/requests",
  "/about",
  "/contact",
  "/security",
  "/privacy",
  "/terms",
  "/resources",
  "/connectors",
  "/customer-feedback-operations",
  "/support-ticket-analysis",
  "/customer-feedback-to-engineering",
  "/close-customer-feedback-loop",
  "/use-cases/product-operations",
  "/guides/customer-feedback-to-fix-workflow",
  "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
  "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
  "/guides/how-to-verify-a-product-fix-worked",
  "/templates/customer-defect-evidence-brief",
  "/integrations/zendesk",
  "/integrations/intercom",
  "/integrations/github",
] as const;

export const PUBLIC_DISCOVERY_PATHS = [
  ...PUBLIC_INDEXABLE_PATHS,
  "/login",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/llms.txt",
  "/opengraph-image",
  "/google8d20992f073290c1.html",
] as const;

export const PRIVATE_APP_PATHS = [
  "/api/",
  "/login",
  "/waitlist",
  "/github/connection-result",
  "/admin",
  "/agent-runs",
  "/notifications",
  "/overview",
  "/onboarding",
  "/feedback",
  "/problems",
  "/pdd",
  "/prioritization",
  "/investigations",
  "/approvals",
  "/follow-up",
  "/integrations",
  "/customers",
  "/settings",
] as const;

export const LANDING_FAQS = [
  {
    question: "Who is CloseSpan for?",
    answer:
      "Customer-success teams at B2B SaaS companies who need to turn customer conversations into clear, actionable product issues.",
  },
  {
    question: "How does the pilot work?",
    answer:
      "We agree on one workflow: turn call summaries into issues, connect product context, investigate, and review a test preview where supported. This workflow is in development; scope is agreed with each design partner.",
  },
  {
    question: "Does CloseSpan replace our existing tools?",
    answer:
      "No. CloseSpan is designed to complement your support and engineering tools. We agree on the connections needed for your pilot rather than asking your team to migrate.",
  },
  {
    question: "Who controls code changes?",
    answer:
      "Your team. The pilot is designed around human approval. A test preview is separate from production, and reviewing it does not authorize a merge or deployment.",
  },
] as const;
