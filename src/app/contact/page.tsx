import type { Metadata } from "next";
import { TrustPublicPage } from "@/components/TrustPublicPage";
import {
  buildTrustMetadata,
  buildTrustStructuredData,
} from "@/lib/TrustPublicSeo";

const title = "Contact CloseSpan | Pilots, Product, and Security";
const description =
  "Contact CloseSpan about a design-partner pilot, product questions, connector requirements, privacy, or a security report.";

export const metadata: Metadata = buildTrustMetadata({
  title,
  description,
  path: "/contact",
});

const structuredData = buildTrustStructuredData({
  name: "Contact CloseSpan",
  description,
  path: "/contact",
  type: "ContactPage",
});

export default function ContactPage() {
  return (
    <TrustPublicPage
      structuredData={structuredData}
      eyebrow="Contact"
      title="Start with the workflow your team needs to fix."
      introduction="Share the customer-feedback workflow, connector requirement, or trust question you want to discuss. Messages go directly to the CloseSpan product owner."
      currentPage="Contact"
      sections={[
        {
          heading: "Design-partner pilots",
          paragraphs: [
            "A useful pilot begins with one recurring customer problem, one or two evidence sources, the people who review product decisions, and a measurable outcome. Include your current workflow, the tools involved, and the part that consumes the most manual effort.",
          ],
          details: [
            { term: "Email", description: "shanmukhsain@gmail.com" },
            { term: "Suggested subject", description: "CloseSpan design-partner pilot" },
            { term: "Helpful context", description: "Team size, feedback sources, workflow owner, and a representative problem" },
          ],
        },
        {
          heading: "Product and connector questions",
          paragraphs: [
            "If you need a connector that is not listed, describe the system, authentication method, records you need imported, and whether CloseSpan would read data or perform an approved write. Connector authorization and data synchronization are separate capabilities, so please identify both needs.",
          ],
        },
        {
          heading: "Security and privacy reports",
          paragraphs: [
            "For a suspected vulnerability or privacy concern, include the affected URL, observed behavior, reproduction steps, and potential impact. Do not send access tokens, passwords, private customer content, or destructive proof of concept material by email.",
            "CloseSpan does not currently publish a guaranteed response or remediation time. Reports are reviewed directly and handled according to severity and available evidence.",
          ],
        },
      ]}
      facts={[
        { label: "Contact", value: "shanmukhsain@gmail.com" },
        { label: "Best for", value: "Pilots, connectors, trust, and product questions" },
        { label: "Do not send", value: "Passwords, tokens, or private customer data" },
      ]}
      notice={{
        title: "No public support SLA yet",
        body: "CloseSpan is an early design-partner product. Contact is handled directly, without a published response-time guarantee.",
      }}
      relatedTitle="Write to CloseSpan directly."
      relatedDescription="Use a clear subject and include enough workflow context to make the first conversation useful."
      relatedLinks={[
        {
          label: "Email CloseSpan",
          href: "mailto:shanmukhsain@gmail.com?subject=CloseSpan%20product%20question",
        },
        { label: "Security", href: "/security" },
        { label: "Privacy", href: "/privacy" },
      ]}
    />
  );
}
