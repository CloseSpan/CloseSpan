export type PlanId = "sandbox" | "design-partner" | "scale";

export type LaunchPlan = {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: readonly string[];
  callToAction: string;
  href: string;
  featured?: boolean;
};

const pilotEmail = "mailto:shanmukhsain@gmail.com?subject=Feedback-to-Fix%20Design%20Partner%20Pilot";

export const launchPlans: readonly LaunchPlan[] = [
  {
    id: "sandbox",
    name: "Interactive sandbox",
    price: "$0",
    cadence: "No card · seeded data",
    description: "Evaluate the complete workflow without connecting customer systems.",
    features: [
      "Realistic simulated customer signals",
      "Problem clustering and impact evidence",
      "Approval, release, and follow-up workflow",
      "No external writes or live customer data",
    ],
    callToAction: "Explore sandbox",
    href: "/overview",
  },
  {
    id: "design-partner",
    name: "Design partner pilot",
    price: "$1,500",
    cadence: "One-time · 6 weeks",
    description: "Prove one feedback-to-fix workflow and its operational ROI before committing.",
    features: [
      "One support source and engineering workflow",
      "Up to three repositories",
      "Human-approved work-item execution",
      "Weekly accuracy and ROI review",
      "Pilot fee credited toward an annual plan",
    ],
    callToAction: "Apply for the pilot",
    href: pilotEmail,
    featured: true,
  },
  {
    id: "scale",
    name: "Scale",
    price: "Custom",
    cadence: "After a successful pilot",
    description: "For multi-product teams that need deeper governance and customer context.",
    features: [
      "CRM and affected-revenue enrichment",
      "Multiple products, teams, and repositories",
      "Observability and release verification",
      "SSO, advanced RBAC, retention, and audit export",
    ],
    callToAction: "Discuss scale",
    href: pilotEmail,
  },
];

export const launchPricingNote = "Expected Team continuation starts around $499/month after a successful pilot. Final packaging will be validated with paid customers before broad release.";
