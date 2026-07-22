import {
  LANDING_FAQS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const faq = LANDING_FAQS.map(
    ({ question, answer }) => `### ${question}\n${answer}`,
  ).join("\n\n");
  const body = `# ${SITE_NAME}\n\n> ${SITE_DESCRIPTION}\n\nCanonical website: ${SITE_URL}/\n\n## Product\n\nClosespan is an AI-assisted feedback-to-fix operations workspace for B2B SaaS product, support, engineering, customer-success, and operations teams. It creates a persistent evidence trail from customer feedback to a prioritized product problem, an approved engineering action, a release, and verified customer follow-up.\n\n## Workflow\n\n1. Normalize customer feedback while preserving its source and evidence.\n2. Propose related problem clusters with inspectable confidence and membership.\n3. Attach affected accounts, revenue, severity, release, and engineering context.\n4. Prepare engineering-ready evidence and require approval for meaningful external actions.\n5. Verify the release outcome and coordinate follow-up with affected customers.\n\n## Integrations\n\nThe connector catalog includes Zendesk, Intercom, Slack, Apple App Store, Google Play, GitHub, Linear, Jira, Sentry, PostHog, and custom webhooks. Capabilities vary by connector. Closespan works above these systems rather than replacing them.\n\n## Trust\n\nCustomer content is treated as evidence, not agent instruction. Confidence, assumptions, affected systems, shared data, reversibility, approval decisions, and audit events remain visible. Workspace access requires Google sign-in and membership.\n\n## Pricing and access\n\nA private authenticated evaluation workspace is available at no charge. A six-week design-partner pilot is listed at $1,500, with custom pricing for larger deployments. Current public details are on ${SITE_URL}/#pricing.\n\n## Frequently asked questions\n\n${faq}\n\n## Public links\n\n- [Closespan home](${SITE_URL}/)\n- [Product](${SITE_URL}/#product)\n- [Workflow](${SITE_URL}/#workflow)\n- [Trust](${SITE_URL}/#trust)\n- [Pricing](${SITE_URL}/#pricing)\n- [FAQ](${SITE_URL}/#faq)\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
