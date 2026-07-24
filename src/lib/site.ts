export const SITE_URL = "https://www.closespan.com";
export const SITE_NAME = "CloseSpan";
export const SITE_TITLE =
  "CloseSpan | Customer Feedback Intelligence for B2B SaaS";
export const SITE_DESCRIPTION =
  "CloseSpan turns B2B SaaS customer feedback into prioritized product problems, engineering-ready evidence, approved actions, and verified fixes.";

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
  "/overview",
  "/feedback",
  "/problems",
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
    question: "What is CloseSpan?",
    answer:
      "CloseSpan is an AI-assisted feedback-to-fix operations workspace for B2B SaaS teams. It keeps customer evidence, business impact, engineering context, approvals, releases, and follow-up connected from the first report through a verified resolution.",
  },
  {
    question: "Who is CloseSpan built for?",
    answer:
      "CloseSpan is built for product operations, support operations, product, engineering, and customer-success teams that need one governed process for recurring customer-reported product problems.",
  },
  {
    question: "How does CloseSpan turn customer feedback into engineering work?",
    answer:
      "CloseSpan normalizes feedback, proposes related problem clusters, attaches account and revenue impact, and prepares engineering-ready evidence and proposed actions for human review. Live provider actions depend on the connector. The workspace then records release evidence, outcome verification, and affected-customer follow-up.",
  },
  {
    question: "Which tools can CloseSpan connect to?",
    answer:
      "The CloseSpan connector catalog includes Zendesk, Intercom, Slack, Apple App Store, Google Play, GitHub, Linear, Jira, Sentry, PostHog, and custom webhooks. Connection, import, synchronization, and action capabilities vary by connector.",
  },
  {
    question: "Does CloseSpan replace Zendesk, Intercom, or GitHub?",
    answer:
      "No. CloseSpan works above the tools a team already uses. It connects customer feedback to a persistent product-problem record and carries approved work into the engineering workflow without replacing the underlying support or delivery systems.",
  },
  {
    question: "Does the AI take actions automatically?",
    answer:
      "Meaningful external actions require human approval by default. CloseSpan keeps confidence, assumptions, evidence, affected systems, shared data, reversibility, and audit history visible so operators can approve, reject, or revise a recommendation.",
  },
] as const;
