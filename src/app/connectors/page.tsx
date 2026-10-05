import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "CloseSpan Connectors | Feedback Sources and Engineering Tools";
const description =
  "Compare CloseSpan connector authorization, feedback import, synchronization, and engineering action capabilities for feedback sources and engineering tools.";

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
      introduction="Connect supported tools through Pipedream, link Retell AI with your API key, or receive feedback through custom webhooks. Account connection, data import, synchronization, and external actions have separate capabilities."
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
            { term: "Slack", description: "Channel feedback intake and scheduled synchronization are implemented. Account connection, channel setup, and a running scheduler are required; mention-only intake also requires the CloseSpan bot." },
            { term: "Discord", description: "Community feedback intake is implemented through the CloseSpan bot. Server installation and channel configuration are required." },
            { term: "Retell AI", description: "Connect your Retell AI account with an API key to import calls, and configure call webhooks for ongoing intake." },
            { term: "Custom webhook", description: "Signed webhook intake accepts supported customer-feedback payloads after endpoint setup." },
          ],
        },
        {
          heading: "Engineering destinations",
          paragraphs: [
            "Engineering destinations receive or enrich approved product work. They are not treated as customer-feedback sources unless a separate import capability is implemented.",
          ],
          details: [
            { term: "GitHub", description: "Account connection and repository-scoped GitHub App workflows are implemented. After repository setup and approval, successful coding runs can publish a branch and draft pull request. Connecting an account alone does not authorize a write." },
          ],
        },
        {
          heading: "More accounts you can connect",
          paragraphs: [
            "Intercom, Linear, Jira, Sentry, PostHog, Apple App Store, and Google Play Store can be connected through Pipedream. Their native feedback import or engineering action adapters are not implemented. Connecting these accounts does not yet import feedback or enable actions.",
          ],
        },
        {
          heading: "Managed authorization",
          paragraphs: [
            "CloseSpan uses Pipedream Connect for supported provider authorization, alongside native GitHub, Slack, Discord, and Retell connections. Each CloseSpan organization maps to a Pipedream external user, while Pipedream stores provider credentials and hosts the connection interface.",
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
        { label: "Ticket import", value: "Zendesk manual pull" },
        { label: "Scheduled feedback intake", value: "Slack, after setup" },
        { label: "Engineering writes", value: "GitHub draft PRs, after setup and approval" },
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
