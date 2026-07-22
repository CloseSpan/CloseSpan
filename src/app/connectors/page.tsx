import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "CloseSpan Connectors | Feedback Sources and Engineering Tools";
const description =
  "Compare CloseSpan connector authorization, feedback import, synchronization, and engineering action capabilities for Zendesk, Intercom, and GitHub.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/connectors",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Connectors",
  description,
  path: "/connectors",
});

export default function ConnectorsPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Connector catalog"
      title="Know what connects, what imports, and what acts."
      introduction="CloseSpan separates provider authorization from data import, continuous synchronization, and external actions. Each connector page states which layer is available today."
      currentPage="Connectors"
      status="Current connector capabilities for the design-partner release"
      sections={[
        {
          heading: "Four different connector states",
          paragraphs: [
            "A connected account is only the first layer of an integration. CloseSpan reports the remaining layers separately so an operator can tell whether source records have actually arrived and whether any write action is available.",
          ],
          details: [
            { term: "Authorization", description: "The provider account has completed a hosted connection flow and is associated with the workspace" },
            { term: "Import", description: "CloseSpan can request supported records and persist normalized workspace data" },
            { term: "Synchronization", description: "A background process keeps supported source records current without a manual pull" },
            { term: "External action", description: "A provider write is implemented and remains behind the required review and approval" },
          ],
        },
        {
          heading: "Feedback sources",
          paragraphs: [
            "Feedback sources bring customer evidence into the CloseSpan inbox. Authorization alone does not populate feedback.",
          ],
          details: [
            { term: "Zendesk", description: "Pipedream authorization and a bounded manual ticket pull are implemented. Continuous sync and Zendesk writes are not implemented." },
            { term: "Intercom", description: "Pipedream authorization is implemented. Conversation import, continuous sync, and Intercom writes are not implemented." },
          ],
        },
        {
          heading: "Engineering destinations",
          paragraphs: [
            "Engineering destinations receive or enrich approved product work. They are not treated as customer-feedback sources unless a separate import capability is implemented.",
          ],
          details: [
            { term: "GitHub", description: "Pipedream authorization is implemented. Repository ingestion, live issue creation, pull-request creation, release sync, and approval-bound writes are not implemented." },
          ],
        },
        {
          heading: "Managed authorization",
          paragraphs: [
            "CloseSpan uses Pipedream Connect for multi-tenant provider authorization. Each CloseSpan organization maps to a Pipedream external user, while Pipedream stores provider credentials and hosts the connection interface.",
            "Workspace members should still review the exact provider account and permissions shown during authorization. CloseSpan connector pages describe intended data use, but the provider authorization screen is the source for the scopes presented by the configured app.",
          ],
        },
        {
          heading: "Unsupported and custom sources",
          paragraphs: [
            "The authenticated product also contains a custom webhook intake path for systems without a supported native importer. Use of that path should be scoped around a documented payload, signed request verification, and only the customer evidence needed for the workflow.",
            "Additional catalog entries may appear inside the application before their import or action adapters are complete. The detailed connector status, not the presence of a catalog card, determines whether a capability is live.",
          ],
        },
      ]}
      facts={[
        { label: "Authorization platform", value: "Pipedream Connect" },
        { label: "Live feedback import", value: "Zendesk manual pull" },
        { label: "Continuous workers", value: "Not yet implemented" },
        { label: "Live engineering writes", value: "Not yet implemented" },
      ]}
      notice={{
        title: "Read the capability, not the badge",
        body: "Connected means account authorization succeeded. It does not mean data has imported, synchronization is running, or an external write is available.",
      }}
      relatedTitle="Review each connector before authorizing it."
      relatedDescription="Check the imported data, permission boundary, operator control, and current limitations for the provider you plan to use."
      relatedLinks={[
        { label: "Zendesk", href: "/integrations/zendesk" },
        { label: "Intercom", href: "/integrations/intercom" },
        { label: "GitHub", href: "/integrations/github" },
      ]}
    />
  );
}
