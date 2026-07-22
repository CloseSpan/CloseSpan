export const SITE_URL = "https://www.closespan.com";
export const SITE_NAME = "Closespan";
export const SITE_TITLE =
  "Closespan | AI Feedback-to-Fix Operations for B2B SaaS";
export const SITE_DESCRIPTION =
  "Closespan turns B2B SaaS customer feedback into prioritized product problems, engineering-ready evidence, approved actions, and verified fixes.";

export const SITE_ALTERNATE_NAMES = ["Closespan AI", "closespan.com"] as const;

export const PUBLIC_DISCOVERY_PATHS = [
  "/",
  "/login",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/llms.txt",
  "/opengraph-image",
  "/google8d20992f073290c1.html",
  "/requests",
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
    question: "What is Closespan?",
    answer:
      "Closespan is an AI-assisted feedback-to-fix operations workspace for B2B SaaS teams. It keeps customer evidence, business impact, engineering context, approvals, releases, and follow-up connected from the first report through a verified resolution.",
  },
  {
    question: "Who is Closespan built for?",
    answer:
      "Closespan is built for product operations, support operations, product, engineering, and customer-success teams that need one governed process for recurring customer-reported product problems.",
  },
  {
    question: "How does Closespan turn customer feedback into engineering work?",
    answer:
      "Closespan normalizes feedback, proposes related problem clusters, attaches account and revenue impact, prepares engineering-ready evidence, and routes meaningful external actions through human approval. It then records the release, verifies the outcome, and coordinates affected-customer follow-up.",
  },
  {
    question: "Which tools can Closespan connect to?",
    answer:
      "The Closespan connector catalog includes Zendesk, Intercom, Slack, Apple App Store, Google Play, GitHub, Linear, Jira, Sentry, PostHog, and custom webhooks. Connection, import, synchronization, and action capabilities vary by connector.",
  },
  {
    question: "Does Closespan replace Zendesk, Intercom, or GitHub?",
    answer:
      "No. Closespan works above the tools a team already uses. It connects customer feedback to a persistent product-problem record and carries approved work into the engineering workflow without replacing the underlying support or delivery systems.",
  },
  {
    question: "Does the AI take actions automatically?",
    answer:
      "Meaningful external actions require human approval by default. Closespan keeps confidence, assumptions, evidence, affected systems, shared data, reversibility, and audit history visible so operators can approve, reject, or revise a recommendation.",
  },
] as const;
