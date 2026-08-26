import {
  LANDING_FAQS,
  SITE_ALTERNATE_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

export const dynamic = "force-static";

const PUBLIC_PAGE_LINKS = [
  [SITE_NAME, "/"],
  ["Resources", "/resources"],
  ["Connector catalog", "/connectors"],
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Security", "/security"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Feature requests and roadmap", "/requests"],
  ["Customer feedback operations", "/customer-feedback-operations"],
  ["Support ticket analysis", "/support-ticket-analysis"],
  ["Customer feedback to engineering", "/customer-feedback-to-engineering"],
  ["Close the customer feedback loop", "/close-customer-feedback-loop"],
  ["Product operations use case", "/use-cases/product-operations"],
  [
    "Customer feedback-to-fix workflow guide",
    "/guides/customer-feedback-to-fix-workflow",
  ],
  [
    "Prioritize customer feedback by revenue impact",
    "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
  ],
  [
    "Turn support tickets into engineering-ready bug reports",
    "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
  ],
  [
    "Verify that a product fix worked",
    "/guides/how-to-verify-a-product-fix-worked",
  ],
  [
    "Customer defect evidence brief template",
    "/templates/customer-defect-evidence-brief",
  ],
  ["Zendesk integration", "/integrations/zendesk"],
  ["Intercom integration", "/integrations/intercom"],
  ["GitHub integration", "/integrations/github"],
] as const;

const LANDING_SECTION_LINKS = [
  ["Product", "/#product"],
  ["Workflow", "/#workflow"],
  ["Trust", "/#trust"],
  ["FAQ", "/#faq"],
] as const;

function renderLinks(links: ReadonlyArray<readonly [string, string]>) {
  return links
    .map(([label, path]) => `- [${label}](${SITE_URL}${path})`)
    .join("\n");
}

export function GET() {
  const faq = LANDING_FAQS.map(
    ({ question, answer }) => `### ${question}\n${answer}`,
  ).join("\n\n");
  const alternateNames = SITE_ALTERNATE_NAMES.join(", ");
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

Canonical website: ${SITE_URL}/
Preferred product name: ${SITE_NAME}
Alternate names: ${alternateNames}

## Product

${SITE_NAME} is an AI-assisted feedback-to-fix operations workspace for B2B SaaS product, support, engineering, customer-success, and operations teams. It creates a persistent evidence trail from customer feedback to a prioritized product problem, an approved engineering action, a release, and verified customer follow-up.

## Workflow

1. Normalize customer feedback while preserving its source and evidence.
2. Propose related problem clusters with inspectable confidence and membership.
3. Attach affected accounts, revenue, severity, release, and engineering context.
4. Prepare engineering-ready evidence and require approval for meaningful external actions.
5. Verify the release outcome and coordinate follow-up with affected customers.

## Integrations

The connector catalog includes Zendesk, Intercom, Slack, Apple App Store, Google Play, GitHub, Linear, Jira, Sentry, PostHog, and custom webhooks. Capabilities vary by connector. ${SITE_NAME} works above these systems rather than replacing them.

## Trust

Customer content is treated as evidence, not agent instruction. Confidence, assumptions, affected systems, shared data, reversibility, approval decisions, and audit events remain visible. Workspace access requires verified Google sign-in and remains scoped to authorized workspace memberships.

## Access

Verified Google users can create a private CloseSpan workspace and use the feedback-to-fix workflow. No paid-plan selection or checkout page is published.

## Frequently asked questions

${faq}

## Public pages

${renderLinks(PUBLIC_PAGE_LINKS)}

## Landing page sections

${renderLinks(LANDING_SECTION_LINKS)}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
