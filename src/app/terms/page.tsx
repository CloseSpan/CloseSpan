import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "CloseSpan Terms of Use | Website and Product Access";
const description =
  "Read the terms for using the CloseSpan public website, authenticated evaluation workspace, connectors, AI features, and design-partner product.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/terms",
});

const structuredData = buildTrustStructuredData({
  name: "CloseSpan Terms of Use",
  description,
  path: "/terms",
});

export default function TermsPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Terms"
      title="Terms for using the CloseSpan website and early product."
      introduction="These terms apply when you visit the public site, submit a feature request, sign in to an evaluation workspace, or use CloseSpan without a separate signed agreement."
      currentPage="Terms"
      status="Effective July 22, 2026"
      sections={[
        {
          heading: "Acceptance and eligibility",
          paragraphs: [
            "By using CloseSpan, you agree to these terms and the privacy policy. You must be able to enter a binding agreement and must use the service for a lawful business or professional purpose. If you use CloseSpan for an organization, you represent that you have authority to act for that organization.",
            "A signed pilot, order form, data-processing agreement, or other written agreement controls if it conflicts with these public terms.",
          ],
        },
        {
          heading: "Accounts and workspace access",
          paragraphs: [
            "Private product access requires a verified Google account and an authorized workspace membership. You are responsible for protecting your Google account, using accurate information, and promptly reporting suspected unauthorized access.",
            "CloseSpan may suspend access needed to protect a workspace, investigate abuse, maintain the service, or comply with law. Self-service member administration is not yet complete.",
          ],
        },
        {
          heading: "Permitted use",
          bullets: [
            "Use only data and provider accounts you are authorized to access.",
            "Follow the terms, policies, and permission boundaries of connected providers.",
            "Do not probe, disrupt, overload, reverse engineer, or bypass access controls except where applicable law expressly permits it.",
            "Do not submit malware, unlawful content, secrets, or personal data that is unnecessary for the workflow.",
            "Do not use AI output as a substitute for required professional, legal, security, or engineering review.",
            "Do not misrepresent simulated or unavailable product behavior as a completed external action.",
          ],
        },
        {
          heading: "Your content and connected providers",
          paragraphs: [
            "You retain your rights in content you submit or authorize CloseSpan to process. You grant CloseSpan the limited rights needed to host, process, transform, display, and transmit that content to provide the requested service.",
            "Connected services such as Google, Pipedream, Zendesk, Intercom, GitHub, and a configured AI provider are governed by their own terms. CloseSpan is not responsible for a third party changing or discontinuing its service, API, permissions, or data.",
          ],
        },
        {
          heading: "AI output and product status",
          paragraphs: [
            "AI classifications, clusters, summaries, and recommendations can be incomplete or incorrect. Review the source evidence, confidence, assumptions, and proposed action before relying on an output.",
            "CloseSpan is an early design-partner product. Some connectors support authorization without data import. Zendesk currently supports a manual feedback pull. Intercom import, GitHub repository ingestion, live issue creation, pull-request creation, and continuous connector workers are not yet implemented. The interface and these integration pages identify current limitations.",
          ],
        },
        {
          heading: "Fees, availability, and changes",
          paragraphs: [
            "Public website access and any evaluation access may be changed or discontinued. Paid pilot scope and fees are defined in the applicable written agreement. CloseSpan does not promise uninterrupted availability, a particular connector, or a specific feature unless that commitment is included in a signed agreement.",
          ],
        },
        {
          heading: "Disclaimers and responsibility",
          paragraphs: [
            "To the extent permitted by law, CloseSpan is provided as available without warranties of merchantability, fitness for a particular purpose, noninfringement, or error-free operation. You remain responsible for product, engineering, customer, security, and compliance decisions made using the service.",
            "To the extent permitted by law, CloseSpan will not be liable under these public terms for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, data, or business opportunity. A signed agreement may provide different terms and limits.",
          ],
        },
        {
          heading: "Contact and updates",
          paragraphs: [
            "Questions about these terms can be sent to shanmukhsain@gmail.com. Terms may be updated as the product and business arrangements change. Continued use after revised terms are published means the revised terms apply, subject to any controlling signed agreement.",
          ],
        },
      ]}
      facts={[
        { label: "Effective", value: "July 22, 2026" },
        { label: "Applies to", value: "Website and unsigned product access" },
        { label: "Signed agreement", value: "Controls when terms conflict" },
        { label: "Contact", value: "shanmukhsain@gmail.com" },
      ]}
      notice={{
        title: "Early product",
        body: "Authorization, import, synchronization, and external actions are separate capabilities. A connected account does not mean every downstream workflow is implemented.",
      }}
      relatedTitle="Need terms for a design-partner pilot?"
      relatedDescription="Pilot scope, data handling, deliverables, and commercial terms should be written into a separate signed agreement."
      relatedLinks={[
        {
          label: "Discuss a pilot",
          href: "mailto:shanmukhsain@gmail.com?subject=CloseSpan%20pilot%20terms",
        },
        { label: "Privacy", href: "/privacy" },
        { label: "Security", href: "/security" },
      ]}
    />
  );
}
