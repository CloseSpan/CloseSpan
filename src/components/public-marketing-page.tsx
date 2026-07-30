import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileCheck2,
  Menu,
} from "lucide-react";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";
import type { PublicSeoPage } from "@/lib/public-seo-pages";
import { PUBLIC_EMAILS } from "@/lib/site";
import styles from "./public-marketing-page.module.css";

const pilotHref =
  `mailto:${PUBLIC_EMAILS.hello}?subject=CloseSpan%20Design%20Partner%20Pilot`;

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export function PublicMarketingPage({ page }: { page: PublicSeoPage }) {
  return (
    <div className={styles.page}>
      {page.structuredData.map((data, index) => (
        <JsonLd data={data} key={`${page.path}-schema-${index}`} />
      ))}

      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="CloseSpan home">
          <CloseSpan3DLogo priority size="md" />
        </Link>

        <nav className={styles.desktopNav} aria-label="Primary navigation">
          <Link href="/customer-feedback-operations">Feedback operations</Link>
          <Link href="/connectors">Connectors</Link>
          <Link href="/use-cases/product-operations">Product operations</Link>
          <Link href="/resources">Resources</Link>
        </nav>

        <div className={styles.headerActions}>
          <Link className={styles.signIn} href="/login">
            Sign in
          </Link>
          <a className={styles.primaryButton} href={pilotHref}>
            Apply for pilot <ArrowRight aria-hidden="true" size={15} />
          </a>
          <details className={styles.mobileMenu}>
            <summary aria-label="Open navigation">
              <Menu aria-hidden="true" size={20} />
            </summary>
            <nav aria-label="Mobile navigation">
              <Link href="/customer-feedback-operations">Feedback operations</Link>
              <Link href="/support-ticket-analysis">Ticket analysis</Link>
              <Link href="/customer-feedback-to-engineering">Feedback to engineering</Link>
              <Link href="/use-cases/product-operations">Product operations</Link>
              <Link href="/resources">Resources</Link>
              <Link href="/connectors">Connectors</Link>
              <Link href="/security">Security</Link>
              <Link href="/about">About</Link>
              <Link href="/requests">Feature requests</Link>
              <Link href="/login">Sign in</Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <div className={styles.breadcrumbWrap}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight size={13} />
              </li>
              <li aria-current="page">{page.breadcrumbLabel}</li>
            </ol>
          </nav>
        </div>

        <section className={styles.hero} aria-labelledby="page-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{page.eyebrow}</p>
            <h1 id="page-title">{page.title}</h1>
            <p className={styles.lede}>{page.lede}</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href={pilotHref}>
                Apply for pilot <ArrowRight aria-hidden="true" size={15} />
              </a>
              <Link className={styles.secondaryButton} href={page.secondaryCta.href}>
                {page.secondaryCta.label}
              </Link>
            </div>
            <p className={styles.heroNote}>
              <FileCheck2 aria-hidden="true" size={16} />
              Evidence stays connected to decisions, approvals, and outcomes.
            </p>
          </div>

          <aside className={styles.summary} aria-labelledby="summary-title">
            <p className={styles.summaryLabel} id="summary-title">
              What this helps you do
            </p>
            <ul>
              {page.highlights.map((highlight) => (
                <li key={highlight}>
                  <span aria-hidden="true">
                    <Check size={14} />
                  </span>
                  {highlight}
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section className={styles.contentLayout} aria-label={`${page.title} details`}>
          <article className={styles.article}>
            {page.sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className={styles.bulletList}>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {section.note && (
                  <aside className={styles.note}>
                    <strong>{section.note.label}</strong>
                    <p>{section.note.text}</p>
                  </aside>
                )}
                {section.codeBlock && (
                  <pre className={styles.templateBlock} tabIndex={0}>
                    <code>{section.codeBlock}</code>
                  </pre>
                )}
                {section.links && section.links.length > 0 && (
                  <div className={styles.sectionLinks}>
                    <span>Continue with</span>
                    {section.links.map((link) => (
                      <Link href={link.href} key={link.href}>
                        {link.label} <ArrowRight aria-hidden="true" size={13} />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </article>

          <aside className={styles.tableOfContents} aria-label="On this page">
            <p>On this page</p>
            <ol>
              {page.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
              {page.steps && (
                <li>
                  <a href="#workflow">{page.stepsTitle}</a>
                </li>
              )}
            </ol>
          </aside>
        </section>

        {page.steps && (
          <section className={styles.stepsSection} id="workflow" aria-labelledby="steps-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Practical workflow</p>
              <h2 id="steps-title">{page.stepsTitle}</h2>
              {page.stepsIntro && <p>{page.stepsIntro}</p>}
            </div>
            <ol className={styles.steps}>
              {page.steps.map((step, index) => (
                <li id={`workflow-step-${index + 1}`} key={step.title}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className={styles.related} aria-labelledby="related-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Keep building the system</p>
            <h2 id="related-title">Related CloseSpan resources</h2>
          </div>
          <div className={styles.relatedGrid}>
            {page.related.map((item) => (
              <Link href={item.href} key={item.href}>
                <span>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <span className={styles.cardLink}>
                  Read more <ArrowRight aria-hidden="true" size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.cta} aria-labelledby="cta-title">
          <div>
            <p className={styles.eyebrow}>One evidence chain</p>
            <h2 id="cta-title">Make the path from feedback to fix inspectable.</h2>
            <p>
              Bring customer reports, business impact, engineering context, approvals,
              releases, and follow-up into one operating record.
            </p>
          </div>
          <div className={styles.ctaActions}>
            <a className={styles.primaryButton} href={pilotHref}>
              Apply for pilot <ArrowRight aria-hidden="true" size={15} />
            </a>
            <Link className={styles.secondaryButton} href="/requests">
              View product requests
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <Link href="/" aria-label="CloseSpan home">
            <CloseSpan3DLogo size="sm" />
          </Link>
          <p>Customer feedback intelligence for accountable product operations.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/customer-feedback-operations">Feedback operations</Link>
          <Link href="/close-customer-feedback-loop">Close the loop</Link>
          <Link href="/templates/customer-defect-evidence-brief">Evidence brief</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/connectors">Connectors</Link>
          <Link href="/about">About</Link>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/requests">Requests</Link>
        </nav>
      </footer>
    </div>
  );
}
