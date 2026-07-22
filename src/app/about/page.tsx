import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "About CloseSpan | Customer Feedback Operations";
const description =
  "Learn why CloseSpan connects customer feedback, product problems, engineering evidence, approvals, releases, and follow-up in one operational workflow.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/about",
});

const structuredData = buildTrustStructuredData({
  name: "About CloseSpan",
  description,
  path: "/about",
  type: "AboutPage",
});

export default function AboutPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="About CloseSpan"
      title="Close the distance between customer evidence and a verified fix."
      introduction="CloseSpan is being built for product and operations teams that need a dependable way to turn recurring customer reports into prioritized, reviewable product work."
      currentPage="About"
      sections={[
        {
          heading: "The problem we are focused on",
          paragraphs: [
            "Customer feedback usually arrives across support tickets, chat, team conversations, reviews, and sales calls. Product and engineering teams then spend hours reconstructing the same problem, estimating impact, finding ownership, and deciding what to do next.",
            "The customer report, business impact, technical evidence, delivery decision, release, and follow-up often live in different systems. That fragmentation makes recurring defects harder to recognize and makes it difficult to prove whether a shipped change solved the customer problem.",
          ],
        },
        {
          heading: "What CloseSpan is designed to do",
          paragraphs: [
            "CloseSpan creates a persistent operating record from feedback to resolution. It keeps source evidence attached to a proposed product problem, adds account and impact context, prepares a reviewable recommendation, and records the decisions that follow.",
          ],
          bullets: [
            "Normalize feedback while preserving source and evidence context.",
            "Propose related problem clusters with inspectable confidence.",
            "Help teams prioritize with severity, frequency, account, and revenue context.",
            "Prepare engineering-ready evidence without treating a model output as confirmed fact.",
            "Keep meaningful external actions behind human review.",
            "Connect the release and customer follow-up back to the original reports.",
          ],
        },
        {
          heading: "Who it is for",
          paragraphs: [
            "CloseSpan is intended for B2B SaaS product operations, support operations, product, engineering, and customer-success teams. It is most useful when the cost of a missed recurring problem is larger than the cost of reviewing evidence carefully.",
            "The current product is an early design-partner release. Some workflows are live, some connector capabilities are limited, and some external actions remain simulated. Public integration pages state those boundaries directly.",
          ],
        },
        {
          heading: "How we want to build",
          paragraphs: [
            "The product is being developed around evidence, operator control, and honest system state. Customer content is treated as untrusted evidence rather than instruction. Recommendations should show confidence and assumptions. A workflow should keep moving when one connector is unavailable, without pretending the unavailable step succeeded.",
            "Design-partner feedback determines which production connectors, review controls, and investigation workflows are built next.",
          ],
        },
      ]}
      facts={[
        { label: "Product category", value: "Customer feedback operations" },
        { label: "Primary users", value: "Product and operations teams" },
        { label: "Current stage", value: "Design-partner release" },
        { label: "Access", value: "Google sign-in and workspace membership" },
      ]}
      notice={{
        title: "Product status matters",
        body: "Capabilities vary by connector. We label unavailable imports and simulated external actions instead of presenting them as production automation.",
      }}
      relatedTitle="Bring one recurring customer problem."
      relatedDescription="A focused pilot starts with real operating friction, a bounded data set, and a reviewable definition of success."
    />
  );
}
