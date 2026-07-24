import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";
import { PUBLIC_EMAILS } from "@/lib/site";

const title = "CloseSpan Intercom Integration | Current Connection Status";
const description =
  "Learn how CloseSpan connects an Intercom account through Pipedream, which conversation data is planned, and why feedback import is not yet available.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/integrations/intercom",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Intercom Integration",
  description,
  path: "/integrations/intercom",
  breadcrumbs: [{ name: "Connectors", path: "/connectors" }],
});

export default function IntercomIntegrationPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Intercom integration"
      title="Prepare Intercom for a feedback workflow, with clear limits."
      introduction="CloseSpan can open a workspace-specific Intercom authorization flow through Pipedream Connect. Conversation import and continuous synchronization are not implemented in the current product."
      currentPage="Intercom"
      parentCrumb={{ label: "Connectors", href: "/connectors" }}
      status="Available now: account authorization only"
      sections={[
        {
          heading: "What works today",
          paragraphs: [
            "A workspace member can open Pipedream Connect, authorize an Intercom account, and let CloseSpan reconcile the resulting account metadata and connection health to the current organization. Pipedream stores the provider credential and hosts the authorization interface.",
            "CloseSpan can show that the account exists and can let a workspace admin disconnect the account. That connection state does not mean conversations have been imported.",
          ],
        },
        {
          heading: "Planned feedback data",
          paragraphs: [
            "The intended Intercom source workflow is to normalize customer conversations into feedback records while retaining enough source context for review. The planned data set includes conversation content, messages, tags, contact references, and relevant timestamps.",
            "This section describes product direction, not a live importer. No Intercom conversation, message, contact, or tag data is currently synchronized into the CloseSpan feedback inbox.",
          ],
        },
        {
          heading: "Permissions and approval boundaries",
          paragraphs: [
            "The exact Intercom permissions are displayed in the hosted provider authorization flow. A production importer should use the least privilege needed to read the selected conversation and contact context. CloseSpan does not currently use the connection to modify conversations, send replies, or create outbound messages.",
          ],
          bullets: [
            "Account authorization is organization-scoped in CloseSpan.",
            "Provider credentials are handled by Pipedream.",
            "A connected state does not trigger an import.",
            "No Intercom write action is currently implemented.",
          ],
        },
        {
          heading: "What must be built before production import",
          bullets: [
            "A provider-specific Intercom importer with bounded pagination and retry handling.",
            "Stable source identifiers and idempotent record updates.",
            "Scope verification, redaction, and safe error handling for conversation content.",
            "Manual backfill controls followed by a tested incremental synchronization worker.",
            "Connection-health and import-freshness reporting that distinguishes authorization from data availability.",
          ],
        },
        {
          heading: "Use another intake path today",
          paragraphs: [
            "Teams that need Intercom feedback in an evaluation today can use a controlled export or the CloseSpan custom webhook after agreeing the data format and handling requirements. Do not assume that connecting the Intercom account will populate the inbox.",
          ],
        },
      ]}
      facts={[
        { label: "Authorization", value: "Pipedream Connect" },
        { label: "Connection", value: "Available" },
        { label: "Conversation import", value: "Not implemented" },
        { label: "Continuous sync", value: "Not implemented" },
        { label: "Intercom writes", value: "Not implemented" },
      ]}
      notice={{
        title: "Authorization only",
        body: "Connecting Intercom currently records account availability and health. It does not populate the feedback inbox.",
      }}
      relatedTitle="Need Intercom conversation import?"
      relatedDescription="Share the objects, history window, volume, and workspace boundaries required for your workflow."
      relatedLinks={[
        {
          label: "Discuss the connector",
          href: `mailto:${PUBLIC_EMAILS.support}?subject=CloseSpan%20Intercom%20connector`,
        },
        { label: "Zendesk", href: "/integrations/zendesk" },
        { label: "GitHub", href: "/integrations/github" },
      ]}
    />
  );
}
