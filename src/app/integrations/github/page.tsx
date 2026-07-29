import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";
import { PUBLIC_EMAILS } from "@/lib/site";

const title = "CloseSpan GitHub Integration | Current Engineering Workflow";
const description =
  "Learn how CloseSpan separates Pipedream account authorization from approval-bound draft pull requests through a repository-scoped GitHub App.";

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
      introduction="CloseSpan uses Pipedream Connect for account-level integration state and a separately configured, repository-scoped GitHub App for approval-bound coding runs. A successful run can create two commits on a dedicated branch and open a draft pull request; it cannot merge, deploy, or mark the customer problem verified."
      currentPage="GitHub"
      parentCrumb={{ label: "Connectors", href: "/connectors" }}
      status="Available when configured: approval-bound draft PRs"
      sections={[
        {
          heading: "What works today",
          paragraphs: [
            "A workspace member can launch a Pipedream-hosted GitHub authorization flow. CloseSpan associates verified account metadata and connection health with the current organization. Pipedream handles the provider credential rather than exposing it to the CloseSpan browser.",
            "Workspace admins explicitly allowlist one GitHub App installation and repository per ticket. The executor reads an exact approved commit, and CloseSpan publishes only to a dedicated closespan/* branch after independent test and scope verification.",
          ],
        },
        {
          heading: "The approval-bound engineering workflow",
          paragraphs: [
            "CloseSpan is designed to connect a reviewed customer problem to repository ownership, relevant code context, existing issues, release evidence, and an approved engineering action. The proposed action should show the evidence, confidence, destination, data shared, and reversibility before an operator approves it.",
            "The engineering-ticket path renders an immutable .prompt artifact, binds approval to its SHA-256 hash and base commit, runs one isolated agent, and opens a draft PR only when required tests and criterion evidence pass. The older demonstration action remains simulated and is labeled separately.",
          ],
        },
        {
          heading: "Permissions and enforced boundaries",
          paragraphs: [
            "The GitHub App is separate from Pipedream credentials. Production use requires an explicit repository allowlist, an exact base branch and SHA, and a single-use approval that expires after 30 minutes.",
          ],
          bullets: [
            "Read repository contents only after repository selection and scope verification.",
            "Bind each proposed write to an approved payload, destination, and expiration.",
            "Require fresh authorization and review when the repository, scope, or payload changes.",
            "Store the resulting issue or pull-request reference and audit event after a confirmed provider response.",
            "Never treat model-generated code or passing implementation tests as release verification.",
          ],
        },
        {
          heading: "Deliberate exclusions",
          details: [
            { term: "Continuous repository ingestion", description: "CloseSpan does not continuously import a repository or build a persistent code graph" },
            { term: "Issue actions", description: "The approval-bound implementation path creates a draft PR, not GitHub issues" },
            { term: "Merges", description: "CloseSpan never merges or writes directly to the default branch" },
            { term: "Release sync", description: "GitHub releases and deployment status are not continuously synchronized" },
            { term: "Customer verification", description: "A PR or passing test suite cannot automatically mark a customer problem Verified" },
          ],
        },
        {
          heading: "How to evaluate the product now",
          paragraphs: [
            "Use the engineering ticket on a product problem to review the exact prompt, repository, base commit, permissions, acceptance matrix, and test commands before approval. Treat the older external-work-item demo as simulated; live draft PRs show a confirmed GitHub URL and machine-readable verification report.",
          ],
        },
      ]}
      facts={[
        { label: "Account connection", value: "Pipedream Connect" },
        { label: "Code authorization", value: "Repository-scoped GitHub App" },
        { label: "Repository access", value: "Exact approved commit" },
        { label: "Issue creation", value: "Simulated only" },
        { label: "Pull requests", value: "Draft only" },
      ]}
      notice={{
        title: "A draft PR is not a release",
        body: "CloseSpan reports a GitHub write only after the provider confirms the branch and draft PR. It never merges, deploys, or marks the original customer problem verified automatically.",
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
