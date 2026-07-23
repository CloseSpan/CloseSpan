import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export type PublicSeoLink = {
  href: string;
  label: string;
};

export type PublicSeoSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  note?: { label: string; text: string };
  codeBlock?: string;
  links?: PublicSeoLink[];
};

export type PublicSeoStep = {
  title: string;
  description: string;
};

export type PublicSeoRelated = {
  href: string;
  label: string;
  title: string;
  description: string;
};

type SchemaKind = "breadcrumb" | "article" | "howto" | "collection";

type PublicSeoPageInput = {
  path: string;
  metadataTitle: string;
  metadataDescription: string;
  breadcrumbLabel: string;
  eyebrow: string;
  title: string;
  lede: string;
  highlights: string[];
  sections: PublicSeoSection[];
  stepsTitle?: string;
  stepsIntro?: string;
  steps?: PublicSeoStep[];
  related: PublicSeoRelated[];
  secondaryCta: PublicSeoLink;
  schemaKind?: SchemaKind;
};

export type PublicSeoPage = Omit<PublicSeoPageInput, "schemaKind"> & {
  structuredData: Record<string, unknown>[];
};

function breadcrumbSchema(page: PublicSeoPageInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: page.breadcrumbLabel,
        item: `${SITE_URL}${page.path}`,
      },
    ],
  };
}

function articleSchema(page: PublicSeoPageInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.metadataDescription,
    mainEntityOfPage: `${SITE_URL}${page.path}`,
    author: {
      "@type": "Organization",
      name: "CloseSpan",
      url: `${SITE_URL}/`,
    },
    publisher: {
      "@type": "Organization",
      name: "CloseSpan",
      url: `${SITE_URL}/`,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon-512.png`,
        width: 512,
        height: 512,
      },
    },
    image: `${SITE_URL}/opengraph-image`,
  };
}

function howToSchema(page: PublicSeoPageInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: page.title,
    description: page.metadataDescription,
    step: (page.steps ?? []).map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.description,
      url: `${SITE_URL}${page.path}#workflow-step-${index + 1}`,
    })),
  };
}

function collectionSchema(page: PublicSeoPageInput): Record<string, unknown> {
  const links = [
    ...page.related.map((item) => item.href),
    ...page.sections.flatMap((section) => section.links?.map((link) => link.href) ?? []),
  ];
  const uniqueLinks = [...new Set(links)].filter((href) => href.startsWith("/"));

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.title,
    description: page.metadataDescription,
    url: `${SITE_URL}${page.path}`,
    hasPart: uniqueLinks.map((href) => ({
      "@type": "WebPage",
      url: `${SITE_URL}${href}`,
    })),
  };
}

function definePage(input: PublicSeoPageInput): PublicSeoPage {
  const structuredData = [breadcrumbSchema(input)];

  if (input.schemaKind === "article" || input.schemaKind === "howto") {
    structuredData.push(articleSchema(input));
  }
  if (input.schemaKind === "howto") {
    structuredData.push(howToSchema(input));
  }
  if (input.schemaKind === "collection") {
    structuredData.push(collectionSchema(input));
  }

  const { schemaKind: _schemaKind, ...page } = input;
  void _schemaKind;
  return { ...page, structuredData };
}

export function createPublicSeoMetadata(page: PublicSeoPage): Metadata {
  return {
    title: { absolute: page.metadataTitle },
    description: page.metadataDescription,
    alternates: { canonical: page.path },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title: page.metadataTitle,
      description: page.metadataDescription,
      type: page.path.startsWith("/guides/") ? "article" : "website",
      url: `${SITE_URL}${page.path}`,
      siteName: "CloseSpan",
      locale: "en_US",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: `${page.metadataTitle} from CloseSpan`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.metadataTitle,
      description: page.metadataDescription,
      images: ["/opengraph-image"],
    },
  };
}

export const customerFeedbackOperationsPage = definePage({
  path: "/customer-feedback-operations",
  metadataTitle: "Customer Feedback Operations: From Signal to Verified Fix",
  metadataDescription:
    "Build a customer feedback operations system that connects source evidence, business impact, engineering decisions, releases, and customer follow-up.",
  breadcrumbLabel: "Customer feedback operations",
  eyebrow: "Operating model",
  title: "Customer feedback operations that end in verified outcomes.",
  lede:
    "Customer feedback operations is the discipline of turning scattered customer reports into accountable product decisions. CloseSpan keeps the evidence chain intact from the original signal through prioritization, engineering work, release verification, and follow-up.",
  highlights: [
    "Preserve source evidence instead of copying vague summaries",
    "Connect customer impact to a persistent product problem",
    "Keep human review visible before external actions",
    "Verify the outcome before declaring the loop closed",
  ],
  sections: [
    {
      id: "why-feedback-operations",
      title: "Why feedback needs an operating system",
      paragraphs: [
        "Most teams already collect feedback. The failure happens after collection. A support ticket becomes a Slack message, the message becomes a shortened issue, and the issue eventually loses the customer, environment, urgency, and business context that made it important.",
        "A feedback operations practice gives every recurring problem a durable record. That record should explain which reports belong together, who is affected, how the impact was assessed, what engineering learned, which decision was approved, and whether the released change actually resolved the customer problem.",
      ],
      bullets: [
        "Support retains the original customer language and account context.",
        "Product sees recurring patterns instead of isolated anecdotes.",
        "Engineering receives reproducible evidence and explicit uncertainty.",
        "Operations can audit decisions and reopen a problem when new evidence conflicts with an earlier conclusion.",
      ],
    },
    {
      id: "canonical-problem-record",
      title: "Use one canonical record for each customer problem",
      paragraphs: [
        "A ticket is a conversation. A product problem is a durable explanation of a failure or unmet need. Several tickets can point to one problem, and one ticket can contain more than one problem. Treating those objects separately prevents ticket volume from becoming the only measure of importance.",
        "The canonical problem record should carry source links, normalized symptoms, affected segments, severity, confidence, revenue exposure, suspected scope, investigation notes, decisions, release evidence, and follow-up status. Each field should be attributable to a source or clearly marked as an inference.",
      ],
      note: {
        label: "Operating principle",
        text: "Never convert uncertainty into a fact just to make a brief look complete. A visible unknown gives engineering a useful question to answer.",
      },
      links: [
        {
          href: "/templates/customer-defect-evidence-brief",
          label: "Customer defect evidence brief",
        },
      ],
    },
    {
      id: "governed-automation",
      title: "Automate preparation while keeping judgment governed",
      paragraphs: [
        "AI can help redact sensitive data, classify reports, suggest clusters, summarize evidence, and prepare actions. Those suggestions should remain reviewable. Confidence, assumptions, affected systems, and the data shared with external tools need to be visible before a manager approves a consequential action.",
        "CloseSpan is designed around that separation. The system prepares evidence and recommendations, while the operator confirms what should be linked, prioritized, created, changed, or communicated. This makes the workflow useful without hiding responsibility behind an automated score.",
      ],
      bullets: [
        "Apply least-privilege connector scopes and workspace isolation.",
        "Redact unnecessary personal information before model processing.",
        "Require review for issue creation, status changes, and customer communication.",
        "Record who approved an action and which evidence was available at the time.",
      ],
    },
    {
      id: "measure-the-system",
      title: "Measure flow quality, not just intake volume",
      paragraphs: [
        "A growing inbox can mean more customers, a worsening product, or simply better collection. Volume alone cannot distinguish those conditions. A useful operating review also tracks time to triage, time to a validated problem, evidence completeness, decision age, repeat reports after release, and affected-customer follow-up.",
        "The purpose is not to manufacture a perfect score. It is to identify where evidence or ownership stops moving. A problem waiting on reproduction needs a different intervention from a verified fix waiting on customer communication.",
      ],
      links: [
        {
          href: "/close-customer-feedback-loop",
          label: "How to close the feedback loop",
        },
      ],
    },
  ],
  stepsTitle: "A feedback operations cycle",
  stepsIntro:
    "Use explicit states so every team can see what is known, what is pending, and who owns the next decision.",
  steps: [
    {
      title: "Capture and normalize",
      description:
        "Bring relevant feedback into a common record while retaining the source, timestamp, customer context, and access boundaries.",
    },
    {
      title: "Review and cluster",
      description:
        "Confirm the feedback is actionable, separate distinct problems, and review suggested relationships before linking reports.",
    },
    {
      title: "Assess impact",
      description:
        "Combine severity, frequency, customer segment, commercial exposure, strategic relevance, and confidence instead of relying on votes alone.",
    },
    {
      title: "Investigate and decide",
      description:
        "Add technical context, record competing explanations, select an action, and preserve the reasons behind the decision.",
    },
    {
      title: "Deliver and verify",
      description:
        "Connect approved work to a release, validate the expected behavior, and monitor the original signal for recurrence.",
    },
    {
      title: "Follow up and learn",
      description:
        "Contact affected customers with relevant context, record the response, and feed any conflicting evidence back into the problem record.",
    },
  ],
  related: [
    {
      href: "/customer-feedback-to-engineering",
      label: "Solution",
      title: "Customer feedback to engineering",
      description: "Prepare a technical handoff without losing customer evidence or business impact.",
    },
    {
      href: "/guides/customer-feedback-to-fix-workflow",
      label: "Guide",
      title: "Feedback-to-fix workflow",
      description: "Implement the operating cycle with explicit review and verification steps.",
    },
    {
      href: "/use-cases/product-operations",
      label: "Use case",
      title: "Product operations",
      description: "Run a repeatable cross-functional review around the evidence chain.",
    },
  ],
  secondaryCta: { href: "/guides/customer-feedback-to-fix-workflow", label: "Read the guide" },
});

export const supportTicketAnalysisPage = definePage({
  path: "/support-ticket-analysis",
  metadataTitle: "Support Ticket Analysis for Product and Engineering Teams",
  metadataDescription:
    "Analyze support tickets as product evidence: preserve customer context, separate facts from inference, find recurring problems, and prepare reviewed handoffs.",
  breadcrumbLabel: "Support ticket analysis",
  eyebrow: "Support intelligence",
  title: "Turn support tickets into evidence your product team can use.",
  lede:
    "Useful support ticket analysis does more than count tags or summarize conversations. It identifies the customer problem, preserves the facts needed to reproduce it, and connects recurring reports without hiding uncertainty.",
  highlights: [
    "Separate the customer symptom from the suspected cause",
    "Retain account, environment, and conversation context",
    "Review suggested relationships before combining tickets",
    "Prepare engineering-ready evidence from the same source record",
  ],
  sections: [
    {
      id: "ticket-as-evidence",
      title: "Treat each ticket as evidence, not as the final problem definition",
      paragraphs: [
        "A support ticket records a conversation shaped by what the customer noticed and what the agent asked. It may contain screenshots, timelines, workarounds, assumptions, and unrelated questions. The ticket is valuable source evidence, but its subject line is rarely a complete product problem.",
        "Start by extracting observable facts: the action attempted, expected result, actual result, timing, environment, frequency, customer impact, and any successful workaround. Keep the suspected cause separate until technical evidence supports it.",
      ],
      bullets: [
        "Quote or link the exact customer description when access controls allow it.",
        "Record what changed before the symptom appeared.",
        "Mark details provided by the customer separately from support or engineering conclusions.",
        "Keep missing reproduction data visible as a request, not an invented value.",
      ],
    },
    {
      id: "find-recurring-patterns",
      title: "Find recurring patterns without flattening meaningful differences",
      paragraphs: [
        "Two customers can describe the same failure in different language, while two similar subject lines can represent different causes. Clustering should consider behavior, affected surface, environment, timing, and outcome instead of relying on keywords alone.",
        "A proposed cluster needs a review path. Operators should be able to inspect why tickets were grouped, split false matches, and revisit earlier memberships when new evidence appears. This preserves the speed of machine-assisted analysis without turning a similarity score into an unchallengeable fact.",
      ],
      note: {
        label: "Good cluster test",
        text: "If one engineering explanation and one verification plan cannot reasonably cover every linked report, the cluster may be too broad.",
      },
    },
    {
      id: "prioritize-context",
      title: "Add business impact without letting revenue erase severity",
      paragraphs: [
        "Support data can connect a product symptom to customer tier, lifecycle stage, renewal timing, contractual commitments, and escalation history. That context improves prioritization, but it should not silently override safety, security, accessibility, or broad product quality concerns.",
        "Use a transparent set of factors and retain the underlying inputs. A manager should be able to explain why a problem moved upward and what would change the ranking. Confidence matters because a large estimated exposure based on one ambiguous report is different from confirmed impact across several accounts.",
      ],
      links: [
        {
          href: "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
          label: "Revenue-aware prioritization guide",
        },
      ],
    },
    {
      id: "connectors-and-boundaries",
      title: "Define connector scope and import boundaries before analysis",
      paragraphs: [
        "A production ticket workflow needs clear rules for which brands, groups, forms, tags, or time ranges are imported. It also needs a documented approach to personal data, deleted records, attachments, and users who no longer have access to the source system.",
        "CloseSpan presents connector permissions and imported data before connection. Actual authentication, available objects, backfill range, and synchronization behavior depend on the source connector and the permissions granted by the customer workspace.",
      ],
      bullets: [
        "Start with the smallest scope that contains useful product feedback.",
        "Document which ticket fields and comments are required for analysis.",
        "Exclude queues that contain unrelated or unusually sensitive conversations.",
        "Monitor import health and make incomplete synchronization visible to reviewers.",
      ],
    },
  ],
  stepsTitle: "A reviewable support ticket analysis workflow",
  stepsIntro:
    "Move from conversation to product evidence without breaking the link back to the source.",
  steps: [
    {
      title: "Select the intake scope",
      description:
        "Choose the relevant views, groups, tags, time window, and fields. Confirm access and redaction expectations before importing.",
    },
    {
      title: "Extract observable evidence",
      description:
        "Capture the symptom, expected behavior, environment, impact, timeline, and attachments while preserving source references.",
    },
    {
      title: "Classify with confidence",
      description:
        "Suggest issue type, product area, severity, and sentiment, then expose confidence so a reviewer can correct uncertain labels.",
    },
    {
      title: "Review recurring problems",
      description:
        "Compare the behavioral evidence, approve or reject proposed relationships, and create a canonical problem only when the scope is coherent.",
    },
    {
      title: "Prepare the handoff",
      description:
        "Attach customer evidence, reproduction gaps, business context, acceptance criteria, and open questions to the engineering brief.",
    },
  ],
  related: [
    {
      href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
      label: "Guide",
      title: "Tickets to engineering-ready bugs",
      description: "Use a precise evidence structure for product and engineering review.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Capture source facts, impact, reproduction, uncertainty, and verification in one record.",
    },
    {
      href: "/customer-feedback-operations",
      label: "Operating model",
      title: "Customer feedback operations",
      description: "Connect support analysis to prioritization, delivery, verification, and follow-up.",
    },
  ],
  secondaryCta: {
    href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
    label: "Build a better bug report",
  },
});

export const customerFeedbackToEngineeringPage = definePage({
  path: "/customer-feedback-to-engineering",
  metadataTitle: "Turn Customer Feedback Into Engineering-Ready Evidence",
  metadataDescription:
    "Connect customer feedback to engineering with reproducible evidence, business context, technical hypotheses, explicit uncertainty, and reviewed actions.",
  breadcrumbLabel: "Customer feedback to engineering",
  eyebrow: "Engineering handoff",
  title: "Give engineering the evidence behind the request.",
  lede:
    "A strong customer-feedback handoff explains the observed problem, its scope, the customers affected, what is known technically, and how success will be verified. It does not ask engineering to reverse-engineer context from a copied support summary.",
  highlights: [
    "Link every conclusion back to customer or technical evidence",
    "Make reproduction gaps and competing explanations visible",
    "Use repository context to focus investigation, not claim certainty",
    "Route issue and pull request actions through human approval",
  ],
  sections: [
    {
      id: "handoff-failure",
      title: "Why customer context disappears at the engineering boundary",
      paragraphs: [
        "Support tools optimize for conversations and service workflows. Engineering tools optimize for implementation and delivery. Copying a ticket into an issue often removes account context, combines symptoms with assumptions, and leaves no reliable path back to affected customers.",
        "The solution is not to paste the entire conversation into GitHub or Jira. It is to prepare a focused evidence brief that keeps source links, separates observation from interpretation, and contains enough context for engineering to evaluate scope and next steps.",
      ],
      links: [
        {
          href: "/templates/customer-defect-evidence-brief",
          label: "Use the evidence brief template",
        },
      ],
    },
    {
      id: "engineering-ready-brief",
      title: "What an engineering-ready brief should contain",
      paragraphs: [
        "The brief begins with an outcome-oriented problem statement: who attempted what, what happened, and why it matters. It then adds representative source evidence, affected environments, reproducibility, known scope, workarounds, frequency, business impact, and open questions.",
        "Acceptance criteria should describe observable behavior, not prescribe an implementation. This gives engineering room to choose a safe solution while keeping the customer outcome testable.",
      ],
      bullets: [
        "Expected behavior and actual behavior in plain language.",
        "Minimal reproduction steps with version, plan, role, device, or browser when relevant.",
        "Representative reports plus the total confirmed and suspected scope.",
        "Logs, traces, screenshots, or release changes with access boundaries noted.",
        "A verification plan tied to the original symptom.",
      ],
    },
    {
      id: "repository-context",
      title: "Use repository context as investigation support",
      paragraphs: [
        "When repository access is available, it can help an agent identify likely ownership, relevant modules, recent changes, tests, and existing issues. That context can narrow an investigation, but semantic similarity does not prove root cause. Suggested files and code paths should remain hypotheses until engineering validates them.",
        "CloseSpan does not currently ingest repository content. Its GitHub connection supports account authorization only, so repository analysis and live issue or pull request actions remain future capabilities. Teams can still use this method with technical context reviewed and added by an operator.",
        "Least-privilege access matters. A workspace should explicitly select repositories, understand requested permissions, and know which code or metadata is sent to an AI provider. External writes, including issue creation and pull request actions, should require approval and produce an audit record.",
      ],
      note: {
        label: "Evidence rule",
        text: "Use code context to explain why a hypothesis is plausible. Use tests, traces, or reproduced behavior to establish whether it is true.",
      },
      links: [
        {
          href: "/integrations/github",
          label: "Review the current GitHub capability",
        },
      ],
    },
    {
      id: "feedback-after-handoff",
      title: "Keep the customer problem linked after the issue is created",
      paragraphs: [
        "An engineering issue is one action in the problem lifecycle, not the system of record for every customer conversation. Preserve the connection between the canonical problem, the approved issue, implementation work, release, verification evidence, and affected customers.",
        "When engineering changes scope or rejects a hypothesis, update the problem record instead of letting the original brief become stale. That feedback improves support responses and prevents the next related ticket from restarting the investigation.",
      ],
      links: [
        {
          href: "/guides/how-to-verify-a-product-fix-worked",
          label: "Verify the released fix",
        },
      ],
    },
  ],
  stepsTitle: "From customer report to reviewed engineering action",
  stepsIntro:
    "Keep the original evidence accessible while progressively adding product and technical context.",
  steps: [
    {
      title: "Confirm the problem boundary",
      description:
        "Separate unrelated requests, identify representative reports, and state the affected behavior without claiming a cause.",
    },
    {
      title: "Build the evidence brief",
      description:
        "Add reproduction, environment, impact, workarounds, frequency, attachments, uncertainty, and a testable customer outcome.",
    },
    {
      title: "Inspect technical context",
      description:
        "Review ownership, code paths, releases, logs, and similar work. Mark likely causes as hypotheses until validated.",
    },
    {
      title: "Review the proposed action",
      description:
        "Let a manager and engineering owner revise the scope, choose a destination, and approve the issue or investigation request.",
    },
    {
      title: "Link delivery and verification",
      description:
        "Keep commits, pull requests, releases, tests, monitoring, and customer confirmation connected to the original problem.",
    },
  ],
  related: [
    {
      href: "/support-ticket-analysis",
      label: "Solution",
      title: "Support ticket analysis",
      description: "Extract reliable product evidence before preparing an engineering handoff.",
    },
    {
      href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
      label: "Guide",
      title: "Engineering-ready bug reports",
      description: "Follow a field-by-field process for better customer-reported bug reports.",
    },
    {
      href: "/close-customer-feedback-loop",
      label: "Workflow",
      title: "Close the feedback loop",
      description: "Carry the engineering decision through release evidence and customer follow-up.",
    },
  ],
  secondaryCta: {
    href: "/templates/customer-defect-evidence-brief",
    label: "Open the evidence template",
  },
});

export const closeCustomerFeedbackLoopPage = definePage({
  path: "/close-customer-feedback-loop",
  metadataTitle: "How to Close the Customer Feedback Loop After a Product Fix",
  metadataDescription:
    "Close the customer feedback loop with release verification, recurrence monitoring, affected-customer follow-up, and a durable record of what changed.",
  breadcrumbLabel: "Close the customer feedback loop",
  eyebrow: "Outcome verification",
  title: "A shipped change is not the same as a closed feedback loop.",
  lede:
    "The loop closes when the team verifies the intended behavior, checks for recurrence, updates the people who reported the problem, and records what it learned. CloseSpan keeps those steps attached to the original evidence and decision.",
  highlights: [
    "Define success before implementation begins",
    "Connect release evidence to the original customer symptom",
    "Monitor recurrence across the same source channels",
    "Send relevant follow-up to affected customers with review",
  ],
  sections: [
    {
      id: "definition-of-closed",
      title: "Define closed as an evidence state",
      paragraphs: [
        "Issue trackers commonly treat merged, deployed, and done as interchangeable. They are not. A pull request can merge without reaching production, a release can deploy without changing the affected path, and a technically correct change can fail to resolve the customer workflow.",
        "A closed product problem should have evidence for the approved action, released version, verification result, recurrence check, and customer follow-up status. If a required check is unavailable, record that limitation rather than silently treating it as passed.",
      ],
      bullets: [
        "Implementation evidence: the reviewed work associated with the problem.",
        "Release evidence: where and when the change became available.",
        "Behavioral evidence: a test of the original expected and actual behavior.",
        "Operational evidence: monitoring for the same error or complaint pattern.",
        "Customer evidence: confirmation, no response, or a conflicting result.",
      ],
    },
    {
      id: "verification-plan",
      title: "Write the verification plan before the fix ships",
      paragraphs: [
        "A verification plan is strongest when it is written alongside acceptance criteria. It identifies the affected environment, the exact behavior to test, the expected result, the person responsible, and the observation window for recurring reports.",
        "Use more than one signal when the risk warrants it. A passing automated test can confirm implementation logic, while production telemetry and a customer retest confirm that the real workflow improved.",
      ],
      links: [
        {
          href: "/guides/how-to-verify-a-product-fix-worked",
          label: "Product fix verification guide",
        },
      ],
    },
    {
      id: "customer-follow-up",
      title: "Make follow-up specific, timely, and reviewable",
      paragraphs: [
        "A good follow-up acknowledges the reported behavior, explains what changed in customer language, states where the change is available, and gives a clear way to respond if the problem persists. It should not expose internal implementation details or promise that every related symptom is resolved.",
        "Different customers may need different messages. A workaround user, an enterprise administrator, and a person who submitted a general feature request do not share the same context. Prepare drafts from the evidence record, then require a human to confirm recipients and wording before sending.",
      ],
      note: {
        label: "Follow-up rule",
        text: "Only contact customers whose source records and communication permissions support the message. Preserve the final approved copy in the audit trail.",
      },
    },
    {
      id: "learn-from-recurrence",
      title: "Treat recurrence as new evidence, not as process failure to hide",
      paragraphs: [
        "A new report after release can mean incomplete rollout, a missed environment, a different root cause, or an overly broad problem cluster. Reopen the record when the evidence conflicts with the closure decision and show what changed.",
        "Over time, teams can compare predicted impact with observed outcomes, identify where verification plans were weak, and improve how they define problem boundaries. The value comes from a trustworthy learning record, not from maximizing the number of items marked done.",
      ],
    },
  ],
  stepsTitle: "A defensible close-the-loop checklist",
  stepsIntro:
    "Use the same evidence chain for implementation, release, verification, and communication.",
  steps: [
    {
      title: "Confirm the approved scope",
      description:
        "Restate the affected behavior and acceptance criteria so the verification does not drift toward whatever was easiest to test.",
    },
    {
      title: "Record the release",
      description:
        "Link the reviewed implementation to the version, environment, feature flag, rollout stage, and availability date.",
    },
    {
      title: "Test the original behavior",
      description:
        "Run the customer-centered acceptance case in the relevant environment and preserve the result or limitation.",
    },
    {
      title: "Watch for recurrence",
      description:
        "Monitor errors, support conversations, and other relevant sources for the same symptom during an appropriate observation window.",
    },
    {
      title: "Review customer follow-up",
      description:
        "Select affected recipients, prepare a contextual message, and require approval before communication leaves the workspace.",
    },
    {
      title: "Close or reopen",
      description:
        "Close with verification evidence, or reopen with the conflicting report and a clear explanation of what remains unresolved.",
    },
  ],
  related: [
    {
      href: "/guides/how-to-verify-a-product-fix-worked",
      label: "Guide",
      title: "Verify a product fix",
      description: "Build a risk-based verification plan around the original customer behavior.",
    },
    {
      href: "/customer-feedback-operations",
      label: "Operating model",
      title: "Customer feedback operations",
      description: "Place verification and follow-up inside the full feedback operating cycle.",
    },
    {
      href: "/customer-feedback-to-engineering",
      label: "Solution",
      title: "Feedback to engineering",
      description: "Create acceptance criteria and preserve the problem evidence before work begins.",
    },
  ],
  secondaryCta: {
    href: "/guides/how-to-verify-a-product-fix-worked",
    label: "Read the verification guide",
  },
});

export const productOperationsUseCasePage = definePage({
  path: "/use-cases/product-operations",
  metadataTitle: "CloseSpan for Product Operations Teams",
  metadataDescription:
    "Give product operations teams a governed workflow for customer evidence, problem review, impact prioritization, engineering handoffs, and outcome verification.",
  breadcrumbLabel: "Product operations use case",
  eyebrow: "Product operations use case",
  title: "Run the customer feedback system, not another disconnected inbox.",
  lede:
    "Product operations teams create the structure that helps support, product, engineering, and customer success make consistent decisions. CloseSpan gives that structure a shared evidence record and explicit review states.",
  highlights: [
    "Standardize intake without forcing every team into one source tool",
    "Facilitate problem and prioritization reviews from shared evidence",
    "Track ownership across product and engineering boundaries",
    "Measure whether decisions reached customers and changed outcomes",
  ],
  sections: [
    {
      id: "product-ops-role",
      title: "Product operations owns the quality of the decision system",
      paragraphs: [
        "Product operations does not need to make every roadmap decision or reproduce every defect. Its leverage comes from defining a reliable process, maintaining clean evidence, clarifying ownership, and making blocked decisions visible across functions.",
        "That requires more than an intake form. Teams need common definitions for feedback, problem, severity, confidence, impact, approved action, verified outcome, and closed loop. CloseSpan provides a workspace where those states remain connected to source records.",
      ],
      bullets: [
        "Define the minimum evidence required before a problem enters review.",
        "Document who can approve clusters, priority changes, and external actions.",
        "Maintain connector scope, synchronization health, and data handling rules.",
        "Review aging work by state and blocker instead of relying on status meetings.",
      ],
    },
    {
      id: "weekly-rhythm",
      title: "Create a weekly review that produces decisions",
      paragraphs: [
        "A useful feedback review is not a tour of dashboards. Participants should see which new problems have sufficient evidence, which existing priorities changed, which investigations need an owner, and which released changes still lack verification or customer follow-up.",
        "Prepare the review asynchronously. Let operators inspect source evidence, propose corrections, and add missing context before the meeting. Then use synchronous time for tradeoffs, approvals, and ownership decisions that require multiple functions.",
      ],
      note: {
        label: "Suggested agenda",
        text: "Review new evidence, changed impact, blocked investigations, approval decisions, unverified releases, and overdue customer follow-up. End with owners and dates for every next action.",
      },
    },
    {
      id: "cross-functional-handoffs",
      title: "Make cross-functional handoffs inspectable",
      paragraphs: [
        "Support should be able to see whether its evidence was linked to a problem. Product should see why a problem is ranked. Engineering should receive a focused brief with technical unknowns. Customer success should know which accounts need follow-up after a release.",
        "A shared evidence chain reduces repeated explanation while preserving each team’s system of work. CloseSpan is designed to connect to source and destination tools, then retain the relationship between the customer problem and the approved external action.",
      ],
      links: [
        {
          href: "/customer-feedback-to-engineering",
          label: "Design the engineering handoff",
        },
      ],
    },
    {
      id: "operating-metrics",
      title: "Use operating metrics that reveal bottlenecks",
      paragraphs: [
        "Counts of tickets, ideas, and shipped features cannot explain whether the feedback system is working. Product operations needs measures aligned to the flow: intake coverage, review age, evidence completeness, cluster corrections, time to decision, investigation age, verification completion, recurrence, and follow-up completion.",
        "Segment metrics by source, product area, severity, and customer group when that comparison is meaningful. Avoid performance targets that encourage teams to close uncertain problems early or merge unlike reports to make the backlog look smaller.",
      ],
    },
  ],
  stepsTitle: "A weekly product operations review",
  stepsIntro:
    "Keep the meeting short by preparing evidence and proposed decisions before participants arrive.",
  steps: [
    {
      title: "Check data health",
      description:
        "Confirm source synchronization, import scope, classification exceptions, and any queues that may be underrepresented.",
    },
    {
      title: "Review new problems",
      description:
        "Inspect representative evidence, approve or split proposed clusters, and identify the next fact needed for uncertain records.",
    },
    {
      title: "Review changed priorities",
      description:
        "Focus on new severity, account, revenue, frequency, strategic, or confidence information that could change a decision.",
    },
    {
      title: "Assign investigations and approvals",
      description:
        "Choose owners, due dates, decision makers, and the approved destination for any external engineering action.",
    },
    {
      title: "Verify completed work",
      description:
        "Review releases awaiting validation, recurrence signals, customer confirmations, and follow-up drafts before closure.",
    },
  ],
  related: [
    {
      href: "/customer-feedback-operations",
      label: "Operating model",
      title: "Customer feedback operations",
      description: "Define the end-to-end states and evidence that product operations governs.",
    },
    {
      href: "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
      label: "Guide",
      title: "Revenue-aware prioritization",
      description: "Use commercial exposure as one transparent input in a broader decision model.",
    },
    {
      href: "/close-customer-feedback-loop",
      label: "Workflow",
      title: "Close the feedback loop",
      description: "Make verification and affected-customer follow-up part of the operating review.",
    },
  ],
  secondaryCta: { href: "/customer-feedback-operations", label: "See the operating model" },
});

export const feedbackToFixGuidePage = definePage({
  path: "/guides/customer-feedback-to-fix-workflow",
  metadataTitle: "Customer Feedback-to-Fix Workflow: A Practical Guide",
  metadataDescription:
    "Build a reviewable customer feedback-to-fix workflow from intake and problem clustering through prioritization, engineering action, verification, and follow-up.",
  breadcrumbLabel: "Customer feedback-to-fix workflow guide",
  eyebrow: "Implementation guide",
  title: "Build a customer feedback-to-fix workflow your team can inspect.",
  lede:
    "This guide turns customer feedback into a sequence of explicit evidence and decision states. It is designed for teams that want AI assistance without losing source traceability, human approval, or responsibility for the outcome.",
  highlights: [
    "Define a durable record that survives tool handoffs",
    "Review classification and clustering before acting",
    "Connect impact, technical context, and decision history",
    "Verify releases and follow up with affected customers",
  ],
  sections: [
    {
      id: "workflow-prerequisites",
      title: "Set the rules before connecting sources",
      paragraphs: [
        "A feedback workflow needs a clear boundary. Decide which products, customer groups, feedback channels, and problem types are in scope. Name the people who can review evidence, change priority, approve external actions, and close a problem.",
        "Document the minimum evidence required at each state. A new signal can enter with incomplete details, but a problem should not move into engineering review without a coherent symptom, representative source evidence, known impact, and explicit gaps.",
      ],
      bullets: [
        "Source ownership and least-privilege connector scopes.",
        "Personal data handling, retention, and redaction rules.",
        "Definitions for severity, confidence, recurrence, and verified outcome.",
        "Approval requirements for issues, status changes, and customer communication.",
      ],
    },
    {
      id: "evidence-chain",
      title: "Design the evidence chain",
      paragraphs: [
        "Use separate but linked records for source feedback, canonical product problems, investigations, approved actions, releases, and follow-up. Each object has a different purpose. Keeping them distinct avoids forcing a support conversation to behave like an engineering issue.",
        "Every transformation should retain provenance. A summary links to its reports, an impact estimate shows its accounts and time window, a technical hypothesis cites code or telemetry, and a closure decision cites release and verification evidence.",
      ],
      note: {
        label: "Traceability test",
        text: "A reviewer should be able to move from any priority or closure claim back to the evidence and assumptions that support it.",
      },
    },
    {
      id: "human-review",
      title: "Place human review where errors become consequential",
      paragraphs: [
        "Automated assistance is useful for redaction, normalization, classification, similarity, summarization, and draft preparation. Review becomes essential when the result changes a problem boundary, priority, external system, customer message, or final outcome.",
        "Do not treat every AI suggestion equally. A low-confidence product-area label can enter a correction queue, while an issue creation request should show the proposed title, destination, shared evidence, permissions, and reversibility before approval.",
      ],
      bullets: [
        "Show confidence and the evidence behind suggested clusters.",
        "Allow operators to split, merge, unlink, and correct records.",
        "Display the exact external action and affected system before execution.",
        "Record reviewer identity, decision time, and changes to the proposal.",
      ],
    },
    {
      id: "pilot-and-improve",
      title: "Pilot one complete loop before expanding intake",
      paragraphs: [
        "Start with one product area and one high-signal source. Follow a small set of problems through review, engineering action, release, verification, and customer follow-up. This exposes missing fields and unclear ownership faster than importing every historical conversation at once.",
        "Expand only after the team can explain how a signal moves, where a person reviews it, and what evidence closes it. Use correction history and blocked states to improve the workflow rather than hiding exceptions with more automation.",
      ],
      links: [
        { href: "/customer-feedback-operations", label: "Feedback operations model" },
        { href: "/close-customer-feedback-loop", label: "Closure and follow-up" },
      ],
    },
  ],
  stepsTitle: "The feedback-to-fix workflow",
  stepsIntro:
    "Treat each step as a visible state with an owner, evidence requirement, and exit condition.",
  steps: [
    {
      title: "Capture source feedback",
      description:
        "Import or submit the report with source reference, timestamp, customer context, permissions, and the original language needed for review.",
    },
    {
      title: "Normalize and redact",
      description:
        "Extract the symptom and operating context, remove unnecessary personal data, and keep facts separate from inferred labels.",
    },
    {
      title: "Review problem relationships",
      description:
        "Inspect suggested matches, split unrelated symptoms, and link only the reports that can share a coherent explanation and outcome.",
    },
    {
      title: "Assess impact and confidence",
      description:
        "Evaluate severity, frequency, customer segment, commercial exposure, strategic relevance, and the completeness of the evidence.",
    },
    {
      title: "Investigate technical context",
      description:
        "Add reproduction, ownership, repository, release, telemetry, and existing-work context. Label suspected causes as hypotheses.",
    },
    {
      title: "Approve an action",
      description:
        "Review the evidence brief and exact external action before creating an issue, changing a status, or communicating a commitment.",
    },
    {
      title: "Link implementation and release",
      description:
        "Connect reviewed engineering work to the deployed version, environment, rollout state, and customer-centered acceptance criteria.",
    },
    {
      title: "Verify, follow up, and learn",
      description:
        "Test the original behavior, monitor recurrence, review customer communication, and reopen the problem when new evidence conflicts with closure.",
    },
  ],
  related: [
    {
      href: "/customer-feedback-operations",
      label: "Operating model",
      title: "Customer feedback operations",
      description: "Define ownership, evidence, governance, and measures for the complete system.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Standardize the record that moves from product review into engineering.",
    },
    {
      href: "/guides/how-to-verify-a-product-fix-worked",
      label: "Guide",
      title: "Verify a product fix",
      description: "Complete the workflow with behavioral, operational, and customer evidence.",
    },
  ],
  secondaryCta: { href: "/resources", label: "Browse all resources" },
  schemaKind: "howto",
});

export const revenuePrioritizationGuidePage = definePage({
  path: "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
  metadataTitle: "How to Prioritize Customer Feedback by Revenue Impact",
  metadataDescription:
    "Use revenue impact responsibly when prioritizing customer feedback by combining confirmed exposure, severity, frequency, strategic context, and confidence.",
  breadcrumbLabel: "Prioritize feedback by revenue impact",
  eyebrow: "Prioritization guide",
  title: "Use revenue impact as evidence, not as the entire roadmap.",
  lede:
    "Revenue context can expose commercially important problems that ticket counts miss. A defensible model keeps the affected accounts, time window, confidence, severity, and non-revenue obligations visible so operators can explain the decision.",
  highlights: [
    "Trace every revenue estimate to affected accounts",
    "Separate confirmed exposure from possible exposure",
    "Balance commercial impact with severity and product obligations",
    "Review scores as decision support, not automatic roadmap commands",
  ],
  sections: [
    {
      id: "define-revenue-impact",
      title: "Define what revenue impact means in your organization",
      paragraphs: [
        "Annual recurring revenue attached to an affected account is not the same as revenue at risk. The customer may have a workaround, the problem may affect one user, or renewal may be years away. Decide whether your model uses affected ARR, expansion influence, renewal risk, contraction risk, or a separately reviewed commercial assessment.",
        "Keep each measure distinct. If account value is available but risk is unknown, label it affected ARR. Do not rename it revenue at risk simply because the larger number attracts attention.",
      ],
      note: {
        label: "Terminology rule",
        text: "Affected revenue describes exposure. At-risk revenue requires evidence of a commercial consequence, such as an escalation, blocked adoption, renewal concern, or documented commitment.",
      },
    },
    {
      id: "build-inputs",
      title: "Build the score from inspectable inputs",
      paragraphs: [
        "Start with a consistent account identifier so feedback can join to the correct commercial record. Define the revenue date, currency treatment, account hierarchy, and how duplicated reports from the same account affect frequency.",
        "Then add the non-revenue factors that protect the model from commercial tunnel vision. Severity, number of affected users, product breadth, security, accessibility, contractual obligations, strategic fit, evidence confidence, and cost of delay can all matter.",
      ],
      bullets: [
        "Confirmed affected accounts and a separate suspected-account list.",
        "Revenue values with source, effective date, and currency normalization.",
        "Severity based on customer outcome, not account size.",
        "Frequency counted by independent occurrence and affected account.",
        "Confidence based on evidence quality and completeness.",
      ],
    },
    {
      id: "avoid-double-counting",
      title: "Avoid double-counting the same commercial signal",
      paragraphs: [
        "Account tier, ARR, renewal risk, and executive escalation often correlate. Adding full weight for each can multiply one commercial fact several times. Map dependencies between factors and choose either a primary measure or capped contributions.",
        "The same caution applies to ticket volume. Ten follow-ups in one incident do not equal ten independently affected customers. Deduplicate conversations at the account and problem level while preserving total interaction burden as a separate service-cost measure.",
      ],
      links: [
        { href: "/support-ticket-analysis", label: "Analyze support evidence" },
      ],
    },
    {
      id: "review-and-calibrate",
      title: "Review rankings with the underlying evidence visible",
      paragraphs: [
        "A score is a compact explanation, not a substitute for one. Reviewers should see which factors drove the ranking, which values are estimates, and how the order changes when uncertain inputs are removed.",
        "Calibrate the model against actual decisions and outcomes. If severe broad-impact problems repeatedly rank below narrow high-ARR requests, adjust caps or weights. Preserve the change history so old decisions remain understandable under the policy that existed at the time.",
      ],
      bullets: [
        "Run sensitivity checks on uncertain revenue and frequency values.",
        "Use separate queues for security, legal, safety, and critical reliability obligations when appropriate.",
        "Review stale scores after account, renewal, severity, or product evidence changes.",
        "Document exceptions and the manager who approved them.",
      ],
    },
  ],
  stepsTitle: "A responsible revenue-aware prioritization process",
  stepsIntro:
    "Build the ranking so a manager can reproduce it and challenge any assumption.",
  steps: [
    {
      title: "Set the decision policy",
      description:
        "Define the decision horizon, eligible problems, revenue measure, non-revenue obligations, review owners, and exception process.",
    },
    {
      title: "Normalize accounts and revenue",
      description:
        "Resolve account identities, parent relationships, currencies, effective dates, and duplicate reports before calculating exposure.",
    },
    {
      title: "Attach problem evidence",
      description:
        "Confirm affected accounts, severity, frequency, user scope, workarounds, renewal context, and confidence from source records.",
    },
    {
      title: "Calculate transparent factors",
      description:
        "Use documented scales, caps, and weights. Keep raw inputs beside the normalized score so the result remains explainable.",
    },
    {
      title: "Review sensitivity and exceptions",
      description:
        "Test uncertain inputs, check protected obligations, compare close scores, and record any manager override with a reason.",
    },
    {
      title: "Recalibrate from outcomes",
      description:
        "Compare predicted impact with adoption, renewal, recurrence, and support outcomes, then update the policy without rewriting history.",
    },
  ],
  related: [
    {
      href: "/use-cases/product-operations",
      label: "Use case",
      title: "Product operations",
      description: "Put revenue-aware decisions inside a recurring cross-functional review.",
    },
    {
      href: "/customer-feedback-operations",
      label: "Operating model",
      title: "Customer feedback operations",
      description: "Connect prioritization inputs to source evidence and downstream outcomes.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Record affected accounts, commercial context, severity, and confidence together.",
    },
  ],
  secondaryCta: { href: "/use-cases/product-operations", label: "See the product ops use case" },
  schemaKind: "howto",
});

export const engineeringBugReportGuidePage = definePage({
  path: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
  metadataTitle: "Turn Support Tickets Into Engineering-Ready Bug Reports",
  metadataDescription:
    "Transform customer support tickets into reviewed bug reports with reproducible evidence, clear scope, business impact, uncertainty, and verification criteria.",
  breadcrumbLabel: "Turn support tickets into bug reports",
  eyebrow: "Engineering handoff guide",
  title: "Turn a customer conversation into a bug report engineering can evaluate.",
  lede:
    "The goal is not to copy the whole support thread into an issue. Build a concise evidence brief that explains the observed behavior, preserves source context, identifies gaps, and gives engineering a testable customer outcome.",
  highlights: [
    "Preserve the original report without overwhelming the issue",
    "Write expected and actual behavior before proposing a cause",
    "Make reproduction quality and uncertainty explicit",
    "Define verification from the customer’s original workflow",
  ],
  sections: [
    {
      id: "extract-facts",
      title: "Extract facts before writing the issue title",
      paragraphs: [
        "Read the complete conversation, including agent questions, attachments, internal notes, and timing. Identify what the customer attempted, what they expected, what occurred, how often it happened, which environment was involved, and what consequence followed.",
        "Keep quotes or source links for important claims. Rewrite sensitive or verbose material into a focused summary only after the source is retained under the appropriate access controls.",
      ],
      bullets: [
        "Customer role, plan, tenant, device, browser, version, and locale when relevant.",
        "The smallest known sequence that produces the behavior.",
        "Screenshots, recordings, request identifiers, timestamps, logs, or traces.",
        "Workaround and whether it is acceptable for the affected customer.",
        "First occurrence, latest occurrence, and any known change before onset.",
      ],
    },
    {
      id: "write-problem-statement",
      title: "Write a behavioral problem statement",
      paragraphs: [
        "A useful title names the product behavior and failure mode, not the customer or a speculative root cause. The opening statement should identify who encounters the problem, under which condition, and what outcome fails.",
        "For example, prefer a statement such as ‘Workspace admins cannot export audit logs when a date range crosses month boundaries’ over ‘Export service date parser is broken.’ The first is testable from customer evidence. The second may later become a validated technical explanation.",
      ],
      note: {
        label: "Writing test",
        text: "A reviewer unfamiliar with the ticket should understand the user action, condition, expected outcome, and actual outcome without guessing.",
      },
    },
    {
      id: "add-scope-impact",
      title: "Add scope and impact without exaggeration",
      paragraphs: [
        "Separate confirmed reports from suspected exposure. List affected accounts or segments, number of independent occurrences, severity of the customer outcome, commercial context, and confidence. Do not multiply ticket replies into additional customers.",
        "State whether the evidence points to a single environment, plan, role, integration, data shape, or release. Also state what appears unaffected. Negative evidence can prevent engineering from investigating an unnecessarily broad surface.",
      ],
      links: [
        {
          href: "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
          label: "Revenue-aware prioritization",
        },
      ],
    },
    {
      id: "acceptance-verification",
      title: "Define acceptance and verification separately",
      paragraphs: [
        "Acceptance criteria describe what must be true for the proposed work to meet the intended product behavior. Verification explains how the team will confirm that behavior after implementation and release.",
        "Include the original reproduction case, relevant regression cases, production signals, and an observation window. When appropriate, ask an affected customer to retest after the team has confirmed availability and communication permissions.",
      ],
      links: [
        {
          href: "/guides/how-to-verify-a-product-fix-worked",
          label: "Fix verification guide",
        },
      ],
    },
  ],
  stepsTitle: "From support ticket to reviewed bug report",
  stepsIntro:
    "Use the source conversation as evidence while shaping a concise, testable engineering record.",
  steps: [
    {
      title: "Read the complete source",
      description:
        "Review the conversation, timestamps, attachments, internal notes, account context, and permissions before summarizing.",
    },
    {
      title: "Separate observations and hypotheses",
      description:
        "List what the customer and team observed. Place suspected causes, related code, and likely ownership in a distinct hypothesis section.",
    },
    {
      title: "Write expected and actual behavior",
      description:
        "Describe the product contract in user language and the specific way the observed result differs from it.",
    },
    {
      title: "Document reproduction and gaps",
      description:
        "Provide the shortest confirmed sequence, environment, reproducibility, artifacts, and the exact missing information needed next.",
    },
    {
      title: "Attach impact and scope",
      description:
        "Show confirmed accounts, occurrences, severity, workarounds, revenue context, product breadth, and confidence without double-counting.",
    },
    {
      title: "Review before creating the issue",
      description:
        "Let support, product, or engineering correct the boundary, choose the destination, and approve the exact external record.",
    },
    {
      title: "Link verification and follow-up",
      description:
        "Keep acceptance criteria, release evidence, recurrence monitoring, and affected-customer communication attached to the bug report.",
    },
  ],
  related: [
    {
      href: "/support-ticket-analysis",
      label: "Solution",
      title: "Support ticket analysis",
      description: "Find coherent recurring problems before opening engineering work.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Copy the field structure for your next customer-reported product problem.",
    },
    {
      href: "/customer-feedback-to-engineering",
      label: "Solution",
      title: "Customer feedback to engineering",
      description: "Connect the evidence brief to code context, approvals, and delivery.",
    },
  ],
  secondaryCta: {
    href: "/templates/customer-defect-evidence-brief",
    label: "Use the evidence template",
  },
  schemaKind: "howto",
});

export const productFixVerificationGuidePage = definePage({
  path: "/guides/how-to-verify-a-product-fix-worked",
  metadataTitle: "How to Verify That a Product Fix Actually Worked",
  metadataDescription:
    "Verify product fixes with implementation, release, behavioral, operational, and customer evidence tied to the original reported problem.",
  breadcrumbLabel: "Verify a product fix",
  eyebrow: "Verification guide",
  title: "Verify the customer outcome, not only the code change.",
  lede:
    "A merged pull request proves that code changed. A verified fix proves that the intended behavior reached the affected environment and addressed the original customer problem without unacceptable regression.",
  highlights: [
    "Write verification criteria from the original problem evidence",
    "Distinguish merged, deployed, available, and verified states",
    "Combine automated, production, and customer signals by risk",
    "Reopen the problem when new evidence contradicts closure",
  ],
  sections: [
    {
      id: "verification-layers",
      title: "Use multiple layers of verification",
      paragraphs: [
        "Different evidence answers different questions. Code review and automated tests support implementation correctness. Release records establish availability. A behavioral test confirms the original user path. Production telemetry looks for recurrence. Customer confirmation checks the real environment and expectations.",
        "Not every problem requires every layer, but the choice should match risk. A copy correction may need a simple production check. A data-loss or authentication defect needs stronger regression, rollout, monitoring, and customer evidence.",
      ],
      bullets: [
        "Implementation: reviewed change and relevant automated tests.",
        "Release: version, environment, rollout stage, and feature-flag state.",
        "Behavior: original reproduction case now produces the expected result.",
        "Operations: error, complaint, or failure pattern does not recur in the observation window.",
        "Customer: affected user can complete the intended workflow or reports a remaining issue.",
      ],
    },
    {
      id: "define-before-build",
      title: "Define success before implementation begins",
      paragraphs: [
        "Use the original expected and actual behavior to write the verification case. Include environment, data setup, role, plan, version, and any condition necessary to reproduce the failure. Name the person responsible for the check and when it should run.",
        "Define the observation window based on usage frequency. A daily workflow can show recurrence quickly, while a monthly export or renewal action needs a longer plan or a direct customer retest.",
      ],
      note: {
        label: "Verification rule",
        text: "If the check cannot fail, it cannot establish that the customer problem was fixed. Write the expected evidence and the evidence that would force a reopen decision.",
      },
    },
    {
      id: "production-evidence",
      title: "Confirm the change reached the affected path",
      paragraphs: [
        "A deployment event alone may not prove availability. Confirm the correct environment, tenant, region, app version, feature flag, data migration, permission, or cache state. Record partial rollout separately from general availability.",
        "Then run the behavioral check against a safe representative case. When production testing is unsafe or impossible, document the substitute evidence and limitation. Keep access to customer data and environments within the approved scope.",
      ],
    },
    {
      id: "recurrence-customer",
      title: "Monitor recurrence and invite conflicting evidence",
      paragraphs: [
        "Watch the same support queues, errors, traces, reviews, or feedback sources that surfaced the problem. Compare equivalent time windows and account for changes in customer volume or instrumentation. A quiet source with a failed sync is not evidence of success.",
        "Follow up with affected customers when appropriate. Ask whether they can complete the intended workflow, not whether they ‘like the fix.’ If a report persists, reopen the problem, attach the new evidence, and reassess whether the cluster contained multiple causes.",
      ],
      links: [
        { href: "/close-customer-feedback-loop", label: "Close the feedback loop" },
      ],
    },
  ],
  stepsTitle: "A risk-based product fix verification process",
  stepsIntro:
    "Preserve each result so the closure decision can be reviewed later.",
  steps: [
    {
      title: "Restate the original failure",
      description:
        "Confirm the user, action, condition, expected behavior, actual behavior, affected environment, and representative source evidence.",
    },
    {
      title: "Choose verification layers",
      description:
        "Select implementation, release, behavioral, operational, and customer checks in proportion to severity and uncertainty.",
    },
    {
      title: "Confirm release availability",
      description:
        "Verify version, environment, rollout, feature flags, migrations, and any customer-specific conditions before testing.",
    },
    {
      title: "Run the behavioral check",
      description:
        "Execute the original case and relevant regressions. Record the result, artifacts, tester, time, and any limitation.",
    },
    {
      title: "Observe recurrence",
      description:
        "Monitor equivalent source and telemetry signals for a defined window while confirming that data collection remains healthy.",
    },
    {
      title: "Confirm with affected customers",
      description:
        "Send reviewed, contextual follow-up and record confirmation, no response, or evidence that the problem remains.",
    },
    {
      title: "Close or reopen with evidence",
      description:
        "Close when the required checks pass. Reopen when a check fails or new evidence conflicts with the original problem boundary.",
    },
  ],
  related: [
    {
      href: "/close-customer-feedback-loop",
      label: "Workflow",
      title: "Close the customer feedback loop",
      description: "Carry verified release evidence into reviewed customer communication.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Define verification criteria alongside the original problem evidence.",
    },
    {
      href: "/guides/customer-feedback-to-fix-workflow",
      label: "Guide",
      title: "Feedback-to-fix workflow",
      description: "Place verification inside the complete operating cycle.",
    },
  ],
  secondaryCta: { href: "/close-customer-feedback-loop", label: "Plan customer follow-up" },
  schemaKind: "howto",
});

const evidenceBriefTemplate = `Problem title
[Affected user or role] cannot [expected outcome] when [condition].

Observed behavior
- Expected:
- Actual:
- First observed:
- Latest observed:
- Frequency:

Representative evidence
- Source record:
- Environment, version, plan, role:
- Screenshot, recording, log, trace, or request ID:

Reproduction
1.
2.
3.
- Reproducibility:
- Missing information:

Scope and impact
- Confirmed affected accounts or users:
- Suspected additional scope:
- Severity and workaround:
- Commercial or contractual context:
- Confidence:

Technical context
- Likely owner or product area:
- Related repository, release, issue, or incident:
- Hypotheses, clearly labeled:

Decision and verification
- Proposed next action:
- Decision owner:
- Acceptance criteria:
- Verification plan:
- Recurrence observation window:
- Affected-customer follow-up:`;

export const evidenceBriefTemplatePage = definePage({
  path: "/templates/customer-defect-evidence-brief",
  metadataTitle: "Customer Defect Evidence Brief Template",
  metadataDescription:
    "Use this customer defect evidence brief template to connect source reports, reproduction, scope, business impact, technical hypotheses, and verification.",
  breadcrumbLabel: "Customer defect evidence brief template",
  eyebrow: "Working template",
  title: "A customer defect evidence brief that keeps facts and assumptions separate.",
  lede:
    "Use this structure when customer-reported product behavior needs product and engineering review. It keeps the brief concise while preserving links to source evidence, impact, uncertainty, decisions, and verification.",
  highlights: [
    "Describe the user outcome before the suspected cause",
    "Keep confirmed scope separate from possible exposure",
    "Give technical hypotheses their own labeled section",
    "Define acceptance and verification before closing the problem",
  ],
  sections: [
    {
      id: "when-to-use",
      title: "When to use this brief",
      paragraphs: [
        "Use the brief after an initial report has enough product relevance to review, but before an engineering issue is treated as committed work. It is suitable for recurring defects, severe single-customer failures, integration problems, regressions, and behavior that crosses support and engineering ownership.",
        "Do not wait for every field to be complete. Mark missing information and assign the next evidence request. The brief should make uncertainty actionable rather than hiding it.",
      ],
      bullets: [
        "Keep source links under the same access controls as the original system.",
        "Remove personal data that is not necessary to investigate the product behavior.",
        "Use representative examples and summarize total confirmed scope separately.",
        "Update the brief when engineering or customer evidence changes the problem boundary.",
      ],
    },
    {
      id: "copy-template",
      title: "Copy the evidence brief",
      paragraphs: [
        "Replace each prompt with evidence or an explicit unknown. Keep links to authoritative source records instead of duplicating sensitive content into every destination system.",
      ],
      codeBlock: evidenceBriefTemplate,
    },
    {
      id: "field-guidance",
      title: "How to complete the fields",
      paragraphs: [
        "Write the title and observed behavior in customer-centered language. Reproduction should be the shortest confirmed sequence, with environment and reliability. Scope should show both confirmed and suspected exposure, while confidence reflects the quality of the supporting evidence.",
        "Technical context can include likely ownership, relevant code, releases, logs, and similar work. Label every root-cause statement as a hypothesis until technical evidence validates it. Acceptance criteria state the intended product behavior; the verification plan states how the team will prove that behavior after release.",
      ],
      links: [
        {
          href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
          label: "Field-by-field bug report guide",
        },
      ],
    },
    {
      id: "review-checklist",
      title: "Review the brief before creating external work",
      paragraphs: [
        "A reviewer should be able to understand the customer outcome, inspect representative evidence, see what remains unknown, evaluate scope and impact, and know how success will be tested. The destination and exact proposed action should also be visible before approval.",
      ],
      bullets: [
        "The problem statement does not claim an unverified cause.",
        "Expected and actual behavior are testable.",
        "Reproduction gaps have a named next step.",
        "Impact values link to accounts, occurrences, and time windows.",
        "Acceptance criteria avoid prescribing an implementation unless required.",
        "Verification includes release availability and the original customer behavior.",
      ],
    },
  ],
  stepsTitle: "Use the brief in a governed workflow",
  stepsIntro:
    "The template becomes more useful when it stays linked to source reports and downstream outcomes.",
  steps: [
    {
      title: "Attach representative sources",
      description:
        "Select the clearest customer reports and preserve source references, access boundaries, timestamps, and account context.",
    },
    {
      title: "Draft observable behavior",
      description:
        "Complete expected, actual, environment, reproduction, impact, and evidence fields before adding a root-cause hypothesis.",
    },
    {
      title: "Review scope and uncertainty",
      description:
        "Confirm which reports belong, split distinct problems, and make missing reproduction or exposure data visible.",
    },
    {
      title: "Approve the next action",
      description:
        "Choose the owner and destination, review what data will be shared, and approve the exact issue or investigation request.",
    },
    {
      title: "Update through verification",
      description:
        "Keep decisions, implementation, release, behavioral checks, recurrence, and customer follow-up connected to the brief.",
    },
  ],
  related: [
    {
      href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
      label: "Guide",
      title: "Support tickets to bug reports",
      description: "Learn how to extract and review every major evidence field.",
    },
    {
      href: "/customer-feedback-to-engineering",
      label: "Solution",
      title: "Customer feedback to engineering",
      description: "Connect the brief to repository context and reviewed engineering actions.",
    },
    {
      href: "/guides/how-to-verify-a-product-fix-worked",
      label: "Guide",
      title: "Verify a product fix",
      description: "Complete the acceptance, release, recurrence, and follow-up sections.",
    },
  ],
  secondaryCta: {
    href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
    label: "Read the bug report guide",
  },
});

export const resourcesPage = definePage({
  path: "/resources",
  metadataTitle: "Customer Feedback Operations Resources",
  metadataDescription:
    "Practical CloseSpan guides, templates, operating models, and use cases for turning customer feedback into reviewed product decisions and verified fixes.",
  breadcrumbLabel: "Resources",
  eyebrow: "Resource library",
  title: "Practical resources for a trustworthy feedback-to-fix system.",
  lede:
    "Use these guides, templates, and operating models to improve how customer evidence moves through product review, engineering action, release verification, and follow-up. Every resource emphasizes traceability, explicit uncertainty, and human control.",
  highlights: [
    "Design the end-to-end operating model",
    "Improve support analysis and engineering handoffs",
    "Prioritize with transparent commercial context",
    "Verify outcomes and complete customer follow-up",
  ],
  sections: [
    {
      id: "start-with-system",
      title: "Start with the operating system",
      paragraphs: [
        "Before choosing a scoring model or connector, define the objects, states, owners, evidence, and approvals that make the workflow trustworthy. The operating model and implementation guide explain how source feedback becomes a persistent problem and how that problem reaches a verified outcome.",
      ],
      links: [
        { href: "/customer-feedback-operations", label: "Customer feedback operations" },
        {
          href: "/guides/customer-feedback-to-fix-workflow",
          label: "Feedback-to-fix implementation guide",
        },
        { href: "/use-cases/product-operations", label: "Product operations use case" },
      ],
    },
    {
      id: "improve-handoffs",
      title: "Improve support and engineering handoffs",
      paragraphs: [
        "Customer conversations contain useful evidence, but they need careful shaping before they become engineering work. These resources show how to separate observed behavior from suspected cause, preserve source context, define scope, and prepare a reviewed action.",
      ],
      links: [
        { href: "/support-ticket-analysis", label: "Support ticket analysis" },
        { href: "/customer-feedback-to-engineering", label: "Feedback to engineering" },
        {
          href: "/guides/turn-support-tickets-into-engineering-ready-bug-reports",
          label: "Engineering-ready bug report guide",
        },
        {
          href: "/templates/customer-defect-evidence-brief",
          label: "Customer defect evidence brief",
        },
      ],
    },
    {
      id: "make-decisions",
      title: "Make impact and priority decisions explainable",
      paragraphs: [
        "Commercial exposure is valuable decision context when its source, time window, and uncertainty remain visible. The prioritization guide shows how to combine it with severity, frequency, product obligations, strategic relevance, and confidence without turning ARR into an automatic roadmap.",
      ],
      links: [
        {
          href: "/guides/how-to-prioritize-customer-feedback-by-revenue-impact",
          label: "Prioritize feedback by revenue impact",
        },
      ],
    },
    {
      id: "verify-outcomes",
      title: "Verify outcomes and close the loop",
      paragraphs: [
        "A change is complete when the team can show that it reached the affected environment, changed the original behavior, did not produce unacceptable regression, and received the appropriate customer follow-up. Use these resources to plan that evidence before implementation begins.",
      ],
      links: [
        {
          href: "/guides/how-to-verify-a-product-fix-worked",
          label: "Product fix verification guide",
        },
        { href: "/close-customer-feedback-loop", label: "Close the feedback loop" },
      ],
    },
  ],
  related: [
    {
      href: "/guides/customer-feedback-to-fix-workflow",
      label: "Start here",
      title: "Customer feedback-to-fix workflow",
      description: "Implement the complete sequence from source evidence to verified outcome.",
    },
    {
      href: "/templates/customer-defect-evidence-brief",
      label: "Template",
      title: "Customer defect evidence brief",
      description: "Use a copy-ready structure for the next customer-reported problem.",
    },
    {
      href: "/use-cases/product-operations",
      label: "Use case",
      title: "CloseSpan for product operations",
      description: "Turn the resource library into a repeatable cross-functional operating rhythm.",
    },
  ],
  secondaryCta: {
    href: "/guides/customer-feedback-to-fix-workflow",
    label: "Start with the workflow guide",
  },
  schemaKind: "collection",
});
