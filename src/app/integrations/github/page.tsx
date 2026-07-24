import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";
import { PUBLIC_EMAILS } from "@/lib/site";

const title = "CloseSpan GitHub Integration | Current Engineering Workflow";
const description =
  "Learn how CloseSpan connects GitHub through Pipedream, how human approval is represented, and which repository and issue workflows are not yet implemented.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/integrations/github",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan GitHub Integration",
  description,
  path: "/integrations/github",
  breadcrumbs: [{ name: "Connectors", path: "/connectors" }],
});

export default function GithubIntegrationPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="GitHub integration"
      title="Connect engineering context without pretending an action shipped."
      introduction="CloseSpan can authorize a GitHub account through Pipedream Connect and represent the connection in a workspace. Repository ingestion, live issue creation, pull-request creation, and approval-bound GitHub writes are not implemented yet."
      currentPage="GitHub"
      parentCrumb={{ label: "Connectors", href: "/connectors" }}
      status="Available now: account authorization only"
      sections={[
        {
          heading: "What works today",
          paragraphs: [
            "A workspace member can launch a Pipedream-hosted GitHub authorization flow. CloseSpan associates verified account metadata and connection health with the current organization. Pipedream handles the provider credential rather than exposing it to the CloseSpan browser.",
            "Workspace admins can view connection state and disconnect an individual account. The connection does not currently read repository content or create a GitHub object.",
          ],
        },
        {
          heading: "The intended engineering workflow",
          paragraphs: [
            "CloseSpan is designed to connect a reviewed customer problem to repository ownership, relevant code context, existing issues, release evidence, and an approved engineering action. The proposed action should show the evidence, confidence, destination, data shared, and reversibility before an operator approves it.",
            "That workflow is visible in the product as a simulated approval path. Approval currently creates a simulated external work item in CloseSpan, not a live GitHub issue or pull request.",
          ],
        },
        {
          heading: "Permissions and future boundaries",
          paragraphs: [
            "The hosted authorization flow displays the GitHub permissions associated with the configured Pipedream app. A production GitHub workflow should separate repository read access from approved write access and should limit both to explicitly selected repositories.",
          ],
          bullets: [
            "Read repository metadata only after repository selection and scope verification.",
            "Bind each proposed write to an approved payload, destination, and expiration.",
            "Require fresh authorization and review when the repository, scope, or payload changes.",
            "Store the resulting issue or pull-request reference and audit event after a confirmed provider response.",
            "Never treat model-generated code context as a confirmed root cause without engineering review.",
          ],
        },
        {
          heading: "What is not implemented",
          details: [
            { term: "Repository ingestion", description: "No repository files, code graph, commits, or ownership data are currently imported" },
            { term: "Issue actions", description: "No live GitHub issue is created, edited, or closed by the current workflow" },
            { term: "Pull requests", description: "No branch, commit, or pull request is created by CloseSpan" },
            { term: "Release sync", description: "GitHub releases and deployment status are not continuously synchronized" },
            { term: "Approval executor", description: "The current approval result is a simulated work item, not an approval-bound GitHub API call" },
          ],
        },
        {
          heading: "How to evaluate the product now",
          paragraphs: [
            "Use the current workspace to review how feedback evidence, business impact, investigation notes, risk, and approval state should be packaged before engineering work is created. Treat every external GitHub object shown in demo data as simulated unless the product explicitly reports a confirmed live provider response.",
          ],
        },
      ]}
      facts={[
        { label: "Authorization", value: "Pipedream Connect" },
        { label: "Connection", value: "Available" },
        { label: "Repository import", value: "Not implemented" },
        { label: "Issue creation", value: "Simulated only" },
        { label: "Pull requests", value: "Not implemented" },
      ]}
      notice={{
        title: "No live GitHub write",
        body: "A connected badge or approved demo action does not mean CloseSpan created an issue, commit, branch, or pull request in GitHub.",
      }}
      relatedTitle="Help define the production GitHub boundary."
      relatedDescription="A useful design review covers repository selection, read scopes, approved writes, payload integrity, and evidence required by engineering."
      relatedLinks={[
        {
          label: "Discuss GitHub workflow",
          href: `mailto:${PUBLIC_EMAILS.support}?subject=CloseSpan%20GitHub%20workflow`,
        },
        { label: "Zendesk", href: "/integrations/zendesk" },
        { label: "Intercom", href: "/integrations/intercom" },
      ]}
    />
  );
}
