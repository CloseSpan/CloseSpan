import { TenkiLogo } from "@/components/tenki-logo";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown,
  Inbox, Layers3, Menu, ShieldCheck,
} from "lucide-react";
import { LandingIntegrationLogo, type LandingIntegrationBrand } from "@/components/landing-integration-logo";
import { CloseSpanLogo } from "@/components/closespan-logo";
import { LandingProductVideo } from "@/components/landing-product-video";
import styles from "./landing-page.module.css";
import {
  LANDING_FAQS,
  SITE_ALTERNATE_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  title: {
    absolute: SITE_TITLE,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
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
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CloseSpan turns customer feedback into product improvements.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      inLanguage: "en-US",
      publisher: { "@id": `${SITE_URL}/#organization` },
      about: { "@id": `${SITE_URL}/#application` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: `${SITE_URL}/`,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/closespan-title-icon-512-v3.png`,
        contentUrl: `${SITE_URL}/closespan-title-icon-512-v3.png`,
        width: 512,
        height: 512,
        caption: `${SITE_NAME} logo`,
      },
      description: SITE_DESCRIPTION,
      knowsAbout: [
        "Customer feedback intelligence",
        "Feedback operations",
        "Product operations",
        "Support ticket analysis",
        "Customer feedback prioritization",
      ],
    },
    {
      "@type": ["SoftwareApplication", "WebApplication"],
      "@id": `${SITE_URL}/#application`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      image: `${SITE_URL}/opengraph-image`,
      inLanguage: "en-US",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Customer feedback intelligence",
      operatingSystem: "Web browser",
      browserRequirements:
        "Requires a modern web browser. Workspace access requires Google sign-in.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      provider: { "@id": `${SITE_URL}/#organization` },
      publisher: { "@id": `${SITE_URL}/#organization` },
      brand: { "@id": `${SITE_URL}/#organization` },
      audience: {
        "@type": "BusinessAudience",
        audienceType:
          "B2B SaaS product, support, engineering, customer-success, and operations teams",
      },
      featureList: [
        "Customer-feedback normalization",
        "Evidence-backed product-problem clustering",
        "Account and revenue impact prioritization",
        "Engineering-ready evidence preparation",
        "Human approval for external actions",
        "Release verification and customer follow-up",
      ],
      isAccessibleForFree: true,
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      mainEntity: LANDING_FAQS.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      })),
    },
  ],
};

const workspaceLoginHref = "/login?callbackUrl=%2Foverview";

const integrations: { name: string; brand: LandingIntegrationBrand; href: string }[] = [
  { name: "Intercom", brand: "intercom", href: "/connectors" },
  { name: "Zendesk", brand: "zendesk", href: "/integrations/zendesk" },
  { name: "Slack", brand: "slack", href: "/connectors" },
  { name: "GitHub", brand: "github", href: "/integrations/github" },
  { name: "Linear", brand: "linear", href: "/connectors" },
  { name: "Jira", brand: "jira", href: "/connectors" },
  { name: "Sentry", brand: "sentry", href: "/connectors" },
  { name: "PostHog", brand: "posthog", href: "/connectors" },
];

const workflow = [
  { title: "Connect your sources", text: "Bring customer feedback and repository context into one workspace." },
  { title: "Let the agent investigate", text: "Group related reports, identify impact, and prepare a testable prompt." },
  { title: "Test and approve", text: "Confirm the result. Keep meaningful external actions under your control." },
  { title: "Close the loop", text: "Track release evidence and follow up with the customers who reported it." },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <a className={styles.skipLink} href="#landing-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navigation}>
          <Link className={styles.brand} href="/" aria-label="CloseSpan home">
            <CloseSpanLogo size="sm" />
          </Link>
          <nav className={styles.desktopNav} aria-label="Landing navigation">
            <Link href="/customer-feedback-operations">Product</Link>
            <Link href="/guides/customer-feedback-to-fix-workflow">How it works</Link>
            <Link href="/connectors">Connectors</Link>
            <Link href="/resources">Resources</Link>
          </nav>
          <div className={styles.headerActions}>
            <Link className={styles.signIn} href="/login">Sign in</Link>
            <Link className={styles.primaryButton} href={workspaceLoginHref}>
              Get started <ArrowRight aria-hidden="true" size={14} />
            </Link>
            <details className={styles.mobileMenu}>
              <summary aria-label="Open navigation"><Menu aria-hidden="true" size={20} /></summary>
              <nav aria-label="Mobile navigation">
                <Link href="/customer-feedback-operations">Product</Link>
                <Link href="/guides/customer-feedback-to-fix-workflow">How it works</Link>
                <Link href="/connectors">Connectors</Link>
                <Link href="/resources">Resources</Link>
                <Link href="/about">About</Link>
                <Link href="/requests">Requests</Link>
                <Link href="/security">Security</Link>
                <Link href="/login">Sign in</Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="landing-content">
        <section className={styles.hero} aria-labelledby="hero-heading">
          <h1 id="hero-heading">Great products start<br className={styles.desktopBreak} /> with listening.</h1>
          <p>Turn customer feedback into tested product improvements.<br className={styles.desktopBreak} /> Your agent does the work. You make the decisions.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={workspaceLoginHref}>
              Get started <ArrowRight aria-hidden="true" size={15} />
            </Link>
            <Link className={styles.secondaryButton} href="#workflow">
              See how it works <ChevronDown aria-hidden="true" size={15} />
            </Link>
          </div>
          <span className={styles.heroNote}>Free to use. Human approval by default.</span>
        </section>

        <section id="product-demo" className={styles.previewSection} aria-label="CloseSpan product video">
          <LandingProductVideo />
          <p id="product-demo-caption" className={styles.demoCaption}>Illustrative workspace · Sample problems and data</p>
        </section>

        <section className={styles.integrations} aria-label="Connector catalog">
          <p>Your tools. One connected workflow.</p>
          <div className={styles.featuredIntegrations}>
            <Link href="/integrations/github" aria-label="GitHub" className={styles.featuredIntegration}>
              <LandingIntegrationLogo brand="github" className={styles.featuredIntegrationLogo} />
              <span>GitHub</span>
            </Link>
            <a href="https://tenki.cloud/" aria-label="Tenki" className={styles.featuredIntegration}>
              <TenkiLogo className={styles.tenkiLogo} />
            </a>
          </div>
          <div className={styles.integrationStrip} role="region" aria-label="Selected connections" tabIndex={0}>
            <ul>
              {integrations.filter((item) => item.brand !== "github").map((item) => (
                <li key={item.name}>
                  <Link href={item.href} aria-label={item.name}>
                    <span>{item.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <Link className={styles.quietLink} href="/connectors">
            Explore connectors and capabilities <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </section>

        <section className={styles.productSection} id="product" aria-labelledby="product-title">
          <div className={styles.sectionHeading}>
            <h2 id="product-title">Less noise.<br />A clearer next step.</h2>
            <div>
              <p>Different words. Different channels. Often the same problem. CloseSpan connects the evidence so your team can focus on what matters.</p>
              <Link className={styles.textLink} href="/customer-feedback-operations">
                Explore the product <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className={styles.evidenceLayout}>
            <div className={styles.evidencePanel}>
              <div className={styles.panelHeading}><Inbox size={16} aria-hidden="true" /><span>Customer signals</span><span className={styles.panelMeta}>Example</span></div>
              <div className={styles.signal}>
                <span className={styles.sourceAvatar}><Inbox size={16} aria-hidden="true" /></span>
                <div><strong>Custom webhook</strong><p>“The export finishes, but the file is empty.”</p></div>
              </div>
              <div className={styles.signal}>
                <span className={styles.sourceAvatar}><Inbox size={16} aria-hidden="true" /></span>
                <div><strong>Zendesk</strong><p>“Our CSV download has zero rows.”</p></div>
              </div>
              <div className={styles.signal}>
                <span className={styles.sourceAvatar}><Inbox size={16} aria-hidden="true" /></span>
                <div><strong>Slack</strong><p>“Large exports stopped working after the release.”</p></div>
              </div>
              <div className={styles.clusterResult}>
                <Layers3 size={18} aria-hidden="true" />
                <div><span>One connected problem</span><strong>Large CSV exports produce empty files</strong></div>
                <Check size={17} aria-hidden="true" />
              </div>
            </div>
            <div className={styles.featureCopy}>
              <article>
                <h3>Understand the problem</h3>
                <p>Keep related reports, customer context, and evidence together.</p>
                <Link href="/support-ticket-analysis">See how signals are analyzed <ArrowUpRight size={14} aria-hidden="true" /></Link>
              </article>
              <article>
                <h3>Prioritize the right work</h3>
                <p>Consider customer impact, affected revenue, severity, and confidence—not just vote counts.</p>
              </article>
              <article>
                <h3>Give engineering a head start</h3>
                <p>Turn the investigation into a reviewable prompt with testable acceptance criteria.</p>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.workflowSection} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}>
            <h2 id="workflow-title">From the first report<br />to the final follow-up.</h2>
            <div>
              <p>One agent-led workflow. Your team steps in to test the result and approve the actions that matter.</p>
              <Link className={styles.textLink} href="/guides/customer-feedback-to-fix-workflow">
                See the full workflow <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <ol className={styles.workflowSteps}>
            {workflow.map((item, index) => (
              <li key={item.title}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.trustSection} id="trust" aria-labelledby="trust-title">
          <div className={styles.trustCopy}>
            <h2 id="trust-title">Built for your work.<br />Under your control.</h2>
            <p>AI recommendations are not permission. Review the evidence and approve, reject, or revise meaningful external actions.</p>
            <ul>
              <li><Check size={15} aria-hidden="true" /> Human approval by default</li>
              <li><Check size={15} aria-hidden="true" /> Sensitive-data redaction</li>
              <li><Check size={15} aria-hidden="true" /> Tenant-scoped audit history</li>
            </ul>
            <Link className={styles.textLink} href="/security">Explore security <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
          <ApprovalPreview />
        </section>

        <section className={styles.faqSection} id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">A few things<br />you might ask.</h2>
          <div className={styles.faqList}>
            {LANDING_FAQS.map(({ question, answer }) => (
              <article key={question}><h3>{question}</h3><p>{answer}</p></article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <h2>Make every piece<br />of feedback count.</h2>
          <p>Start your feedback-to-fix workspace.</p>
          <Link className={styles.primaryButton} href={workspaceLoginHref}>Get started <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link className={styles.brand} href="/" aria-label="CloseSpan home"><CloseSpanLogo size="sm" /></Link>
          <p>From customer feedback to verified fix.</p>
        </div>
        <nav className={styles.footerLinks} aria-label="Footer navigation">
          <Link href="/customer-feedback-operations">Product</Link>
          <Link href="/connectors">Connectors</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/about">About</Link>
          <Link href="/requests">Requests</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </footer>
      <p className={styles.trademarkNotice}>Product names and logos belong to their respective owners. Their use identifies integrations and does not imply endorsement of CloseSpan.</p>
    </div>
  );
}

function ApprovalPreview() {
  return (
    <div className={styles.approvalPreview} aria-label="Illustrative approval request">
      <div className={styles.approvalHeader}><ShieldCheck size={18} aria-hidden="true" /><span>Action approval</span><span className={styles.panelMeta}>Example</span></div>
      <div className={styles.approvalBody}>
        <span className={styles.reviewStatus}>Awaiting your decision</span>
        <h3>Create an issue for empty CSV exports</h3>
        <p>Proposed GitHub issue · analytics-api</p>
        <dl>
          <div><dt>Evidence</dt><dd>3 corroborating reports</dd></div>
          <div><dt>Data shared</dt><dd>Redacted quotes and environment details</dd></div>
          <div><dt>Reversible</dt><dd>Issue can be edited or closed</dd></div>
        </dl>
        <div className={styles.approvalActions}>
          <span className={styles.simulatedSecondary}>Reject</span>
          <span className={styles.simulatedPrimary}>Approve action <Check size={13} aria-hidden="true" /></span>
        </div>
        <p className={styles.approvalNote}>Illustrative approval. No action will be taken.</p>
      </div>
    </div>
  );
}
