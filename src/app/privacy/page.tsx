import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";
import { PUBLIC_EMAILS } from "@/lib/site";

const title = "CloseSpan Privacy Policy | Data and Connector Processing";
const description =
  "Read how CloseSpan handles account, workspace, feedback, connector, analytics, and AI-provider data in the current product.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/privacy",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Privacy Policy",
  description,
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Privacy"
      title="How CloseSpan handles data in the current product."
      introduction="This policy describes the information CloseSpan processes when you visit the public website, sign in, use a workspace, connect a provider, or configure AI analysis."
      currentPage="Privacy"
      status="Effective July 22, 2026"
      sections={[
        {
          heading: "Information we process",
          details: [
            { term: "Identity data", description: "Google account email, display name, verified identity status, session data, and workspace membership" },
            { term: "Workspace data", description: "Organization settings, members, feedback, customer references, product problems, impact context, reviews, approvals, and audit events" },
            { term: "Connector data", description: "Provider account identifiers, connection health, authorized scopes, import status, and records imported through supported connector workflows" },
            { term: "AI configuration", description: "Selected provider, model, encrypted workspace API key when supplied, model-run metadata, and structured analysis results" },
            { term: "Technical data", description: "Request metadata, error logs, security events, and aggregate product analytics needed to operate and improve the service" },
            { term: "Public requests", description: "Feature-request text, voting controls, moderation status, and security metadata used to limit duplicate or abusive submissions" },
          ],
        },
        {
          heading: "Why we use information",
          bullets: [
            "Authenticate users and enforce workspace membership.",
            "Provide feedback ingestion, review, prioritization, and workflow features.",
            "Connect authorized provider accounts and report connection health.",
            "Run AI analysis only when a supported provider is configured and the workflow requests it.",
            "Protect the service, diagnose failures, prevent duplicate actions, and maintain audit history.",
            "Understand aggregate product usage and improve the public website and application.",
            "Respond to product, pilot, privacy, and security questions.",
          ],
        },
        {
          heading: "Service providers and connected systems",
          paragraphs: [
            "CloseSpan relies on hosting, database, authentication, product analytics, connector authorization, and optional AI-model providers to operate the service. These providers process information only for the relevant service function and under their own contractual and privacy terms.",
            "Pipedream stores connected-provider credentials and facilitates provider authorization. Google supplies identity authentication. Cloudflare Turnstile evaluates browser and request signals when an anonymous visitor submits or votes on a public feature request. When a workspace configures an AI provider, redacted or minimized workspace content needed for that requested analysis may be sent to the selected provider. CloseSpan does not sell personal information or use workspace feedback for advertising.",
          ],
        },
        {
          heading: "Retention, access, and deletion",
          paragraphs: [
            "Workspace records are retained while they are needed to provide the service, maintain workflow history, meet security needs, or satisfy an applicable agreement. The current product does not yet provide complete self-service retention, export, or deletion controls.",
            `To request access, correction, or deletion, email ${PUBLIC_EMAILS.privacy}. Requests may require identity and workspace-authority verification. Provider credentials and source records may also need to be removed in the connected provider or Pipedream account.`,
          ],
        },
        {
          heading: "Security and product maturity",
          paragraphs: [
            "CloseSpan uses technical and organizational controls described on the security page, but no internet service can guarantee absolute security. The product is in an early design-partner stage. Row-level database security and complete data-lifecycle automation are not yet implemented, so sensitive production use should be agreed and scoped before data is connected.",
          ],
        },
        {
          heading: "Changes and contact",
          paragraphs: [
            `This policy may change as the product, providers, and legal requirements change. The effective date will be updated when material changes are published. Privacy questions and requests can be sent to ${PUBLIC_EMAILS.privacy}.`,
          ],
        },
      ]}
      facts={[
        { label: "Effective", value: "July 23, 2026" },
        { label: "Contact", value: PUBLIC_EMAILS.privacy },
        { label: "Data sale", value: "No sale of personal information" },
        { label: "Self-service deletion", value: "Not yet available" },
      ]}
      notice={{
        title: "Connector data varies",
        body: "The records processed depend on the provider, the scopes you authorize, and the import capability that is actually implemented for that connector.",
      }}
      relatedTitle="Need to make a privacy request?"
      relatedDescription="Include the Google email and workspace connected to the request so identity and authority can be verified."
      relatedLinks={[
        {
          label: "Email a privacy request",
          href: `mailto:${PUBLIC_EMAILS.privacy}?subject=CloseSpan%20privacy%20request`,
        },
        { label: "Security", href: "/security" },
        { label: "Terms", href: "/terms" },
      ]}
    />
  );
}
