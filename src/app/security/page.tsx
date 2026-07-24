import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";
import { PUBLIC_EMAILS } from "@/lib/site";

const title = "CloseSpan Security | Access, Data, and AI Controls";
const description =
  "Review the security controls implemented in CloseSpan, current product boundaries, provider credential handling, AI safeguards, and outstanding production gates.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/security",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Security",
  description,
  path: "/security",
});

export default function SecurityPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Security"
      title="Security controls should be visible, and gaps should be named."
      introduction="CloseSpan combines identity checks, workspace-scoped application access, managed connector authorization, redaction, encrypted AI credentials, and human review. It is still an early product and does not claim security certifications."
      currentPage="Security"
      status="Current product posture, not a certification or audit report"
      sections={[
        {
          heading: "Identity and workspace access",
          paragraphs: [
            "Google is the only supported sign-in provider. In production, a verified Google identity must also match a database-backed workspace membership before private product routes are available.",
            "Application queries include an organization identifier so records are read and changed within the selected workspace. PostgreSQL row-level security is not enabled yet, so tenant isolation currently depends on application enforcement and repository-level query scoping.",
          ],
        },
        {
          heading: "Connector and credential handling",
          paragraphs: [
            "CloseSpan uses Pipedream Connect for multi-tenant provider authorization. Pipedream stores provider credentials, and the browser receives a short-lived hosted connection flow rather than the provider credential itself.",
            "AI provider keys entered in workspace settings are encrypted with AES-256-GCM, bound to the organization and provider, masked in the interface, and not returned to the browser after storage. Deployment-managed provider keys can also be used by the server.",
          ],
        },
        {
          heading: "AI and customer-content boundaries",
          bullets: [
            "Feedback text is treated as untrusted evidence, not as agent instruction.",
            "Supported AI analysis runs use bounded structured output and do not grant the model tools.",
            "Text preprocessing detects and redacts common secrets and personal identifiers before supported model analysis.",
            "Model-run records, proposed analyses, and review decisions are stored within the workspace scope.",
            "A model proposal does not directly merge feedback into a product problem without human review.",
          ],
        },
        {
          heading: "Actions, auditability, and current limitations",
          paragraphs: [
            "Workflow mutations use request validation, tenant checks, idempotency keys, and audit records. Anonymous public feature-request submissions and votes also require server-verified Cloudflare Turnstile tokens, while voting retains its one-vote-per-network-address control. The current GitHub external-work-item path is simulated, not a live GitHub issue or pull-request action.",
            "Production gates that remain open include database row-level security, complete retention and deletion workflows, production audit export, background connector workers, and provider-specific imports beyond the current Zendesk manual pull. These gaps should be resolved before broad use with sensitive customer data.",
          ],
          details: [
            { term: "Implemented", description: "Google identity, membership checks, tenant-scoped queries, Pipedream-hosted authorization, Turnstile protection for anonymous requests, redaction, encrypted AI keys, and audit events" },
            { term: "Not claimed", description: "SOC 2, ISO 27001, HIPAA, PCI DSS, or independent penetration-test certification" },
            { term: "Still required", description: "RLS defense in depth, complete lifecycle controls, worker hardening, and broader connector verification" },
          ],
        },
        {
          heading: "Report a security concern",
          paragraphs: [
            `Send a concise report to ${PUBLIC_EMAILS.security} with the affected URL, reproduction steps, observed impact, and a safe proof of concept. Do not include live credentials or private customer records. No public bug-bounty program or guaranteed response time is currently offered.`,
          ],
        },
      ]}
      facts={[
        { label: "Authentication", value: "Verified Google identity" },
        { label: "Authorization", value: "Database-backed workspace membership" },
        { label: "Connector credentials", value: "Hosted by Pipedream" },
        { label: "Certifications", value: "None claimed" },
      ]}
      notice={{
        title: "Early product boundary",
        body: "Do not treat this page as evidence of a completed audit. Confirm controls and data requirements in a signed pilot agreement before sharing sensitive production data.",
      }}
      relatedTitle="Have a security or data-handling question?"
      relatedDescription="Ask for the control, system boundary, or connector behavior you need to verify."
      relatedLinks={[
        {
          label: "Report a concern",
          href: `mailto:${PUBLIC_EMAILS.security}?subject=CloseSpan%20security%20report`,
        },
        { label: "Privacy", href: "/privacy" },
        { label: "Contact", href: "/contact" },
      ]}
    />
  );
}
