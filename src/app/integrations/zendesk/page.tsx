import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "CloseSpan Zendesk Integration | Import Support Feedback";
const description =
  "Connect Zendesk through Pipedream, manually import support tickets into CloseSpan, review normalized customer feedback, and understand current sync limitations.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/integrations/zendesk",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Zendesk Integration",
  description,
  path: "/integrations/zendesk",
  breadcrumbs: [{ name: "Connectors", path: "/connectors" }],
});

export default function ZendeskIntegrationPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Zendesk integration"
      title="Turn Zendesk tickets into reviewable product feedback."
      introduction="CloseSpan can authorize a workspace-specific Zendesk account through Pipedream Connect and manually pull ticket data into the feedback inbox. Continuous synchronization is not implemented yet."
      currentPage="Zendesk"
      parentCrumb={{ label: "Connectors", href: "/connectors" }}
      status="Available now: OAuth connection and manual ticket import"
      sections={[
        {
          heading: "How the connection works",
          paragraphs: [
            "A workspace member starts the connection from CloseSpan. Pipedream opens a hosted Zendesk authorization flow and associates the verified account with that CloseSpan workspace. Provider credentials remain with Pipedream rather than being returned to the CloseSpan browser.",
            "After the account is connected, a workspace member can request a manual pull. CloseSpan verifies that the Pipedream account belongs to the current organization before requesting Zendesk tickets.",
          ],
        },
        {
          heading: "Data CloseSpan currently imports",
          details: [
            { term: "Ticket content", description: "Ticket description, with subject used when a description is not available" },
            { term: "Customer reference", description: "Zendesk requester or organization identifier used as a source reference" },
            { term: "Operational context", description: "Ticket priority, type, tags, source identifier, and creation timestamp when available" },
            { term: "Normalized fields", description: "Feedback type, severity, source, redaction status, confidence, and observed time" },
          ],
          paragraphs: [
            "Imported text passes through CloseSpan redaction before it is stored as normalized feedback. The current importer retrieves a bounded set of ticket pages per manual run and updates existing records when the same source ticket is pulled again.",
          ],
        },
        {
          heading: "Permissions and control",
          paragraphs: [
            "Read access to relevant Zendesk ticket data is required. The hosted Zendesk and Pipedream authorization screens show the account and permissions presented by the provider. Only authorize an account and scope that your organization permits CloseSpan to process.",
          ],
          bullets: [
            "The connection is scoped to the current CloseSpan organization.",
            "Multiple provider accounts can be represented as separate connections.",
            "Workspace admins can disconnect an individual Pipedream account from CloseSpan.",
            "The importer is read-only and does not change Zendesk tickets.",
          ],
        },
        {
          heading: "What happens after import",
          paragraphs: [
            "Imported Zendesk tickets appear as feedback records. A configured AI provider can propose classifications and related product problems. Those proposals remain reviewable and do not merge feedback into a problem without an operator decision.",
            "Product problems, impact context, investigations, approvals, release state, and customer follow-up are managed in CloseSpan. CloseSpan does not replace Zendesk as the source support system.",
          ],
        },
        {
          heading: "Current limitations",
          bullets: [
            "Imports start only when a workspace member requests a manual pull.",
            "Continuous background synchronization and scheduled incremental imports are not implemented.",
            "The current importer focuses on tickets and does not provide a complete Zendesk object mirror.",
            "Ticket comments, user profiles, and organization records are not independently persisted as full source objects by the current importer.",
            "CloseSpan does not currently write ticket updates or customer replies back to Zendesk.",
          ],
        },
      ]}
      facts={[
        { label: "Authorization", value: "Pipedream Connect" },
        { label: "Connection", value: "Available" },
        { label: "Feedback import", value: "Manual pull" },
        { label: "Continuous sync", value: "Not yet implemented" },
        { label: "Zendesk writes", value: "Not implemented" },
      ]}
      notice={{
        title: "Connection is not synchronization",
        body: "A successful OAuth connection makes the account available. Feedback appears only after a supported import runs successfully.",
      }}
      relatedTitle="Evaluate Zendesk feedback in CloseSpan."
      relatedDescription="Connect a permitted account, run a bounded manual pull, and review the resulting feedback before expanding the workflow."
      relatedLinks={[
        {
          label: "Sign in to connect",
          href: "/login?callbackUrl=%2Fintegrations",
        },
        { label: "Intercom", href: "/integrations/intercom" },
        { label: "GitHub", href: "/integrations/github" },
      ]}
    />
  );
}
