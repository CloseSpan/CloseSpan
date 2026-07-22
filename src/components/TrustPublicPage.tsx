import Link from "next/link";
import { Menu } from "lucide-react";
import { CloseSpanLogo } from "@/components/closespan-logo";
import styles from "./TrustPublicPage.module.css";

export interface TrustPageSection {
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
  details?: ReadonlyArray<{ term: string; description: string }>;
}

interface TrustPublicPageProps {
  structuredData: object;
  eyebrow: string;
  title: string;
  introduction: string;
  currentPage: string;
  parentCrumb?: { label: string; href: string };
  status?: string;
  sections: readonly TrustPageSection[];
  facts: ReadonlyArray<{ label: string; value: string }>;
  notice?: { title: string; body: string };
  relatedTitle?: string;
  relatedDescription?: string;
  relatedLinks?: ReadonlyArray<{ label: string; href: string }>;
}

const defaultRelatedLinks = [
  { label: "Apply for a pilot", href: "mailto:shanmukhsain@gmail.com?subject=CloseSpan%20Design%20Partner%20Pilot" },
  { label: "About", href: "/about" },
  { label: "Security", href: "/security" },
] as const;

export function TrustPublicPage({
  structuredData,
  eyebrow,
  title,
  introduction,
  currentPage,
  parentCrumb,
  status,
  sections,
  facts,
  notice,
  relatedTitle = "Want to evaluate CloseSpan with your workflow?",
  relatedDescription = "Start with one recurring customer problem and a clearly scoped design-partner pilot.",
  relatedLinks = defaultRelatedLinks,
}: TrustPublicPageProps) {
  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <a className="skip-link" href="#public-page-content">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="CloseSpan home">
            <CloseSpanLogo size="md" tone="inverse" />
          </Link>
          <nav className={styles.nav} aria-label="Public website navigation">
            <Link href="/customer-feedback-operations">Feedback operations</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/connectors">Connectors</Link>
            <Link href="/requests">Requests</Link>
            <Link className={styles.contactLink} href="/contact">
              Contact
            </Link>
          </nav>
          <details className={styles.mobileMenu}>
            <summary aria-label="Open navigation">
              <Menu aria-hidden="true" size={20} />
            </summary>
            <nav aria-label="Mobile navigation">
              <Link href="/customer-feedback-operations">Feedback operations</Link>
              <Link href="/resources">Resources</Link>
              <Link href="/connectors">Connectors</Link>
              <Link href="/requests">Requests</Link>
              <Link href="/about">About</Link>
              <Link href="/security">Security</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/login">Sign in</Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="public-page-content">
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <span aria-hidden="true">/</span>
              {parentCrumb && (
                <>
                  <Link href={parentCrumb.href}>{parentCrumb.label}</Link>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span aria-current="page">{currentPage}</span>
            </nav>
            <div className={styles.eyebrow}>{eyebrow}</div>
            <h1>{title}</h1>
            <p className={styles.lead}>{introduction}</p>
            {status && <div className={styles.status}>{status}</div>}
          </div>
        </section>

        <div className={styles.body}>
          <article className={styles.article}>
            {sections.map((section) => (
              <section className={styles.section} key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {section.details && (
                  <dl className={styles.details}>
                    {section.details.map((detail) => (
                      <div className={styles.detail} key={detail.term}>
                        <dt>{detail.term}</dt>
                        <dd>{detail.description}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            ))}
          </article>

          <aside className={styles.aside} aria-label="Page summary">
            <section className={styles.asideCard}>
              <h2>At a glance</h2>
              <dl className={styles.facts}>
                {facts.map((fact) => (
                  <div className={styles.fact} key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {notice && (
              <section className={styles.notice}>
                <strong>{notice.title}</strong>
                <p>{notice.body}</p>
              </section>
            )}
          </aside>
        </div>

        <section className={styles.related} aria-labelledby="public-page-next-step">
          <div>
            <h2 id="public-page-next-step">{relatedTitle}</h2>
            <p>{relatedDescription}</p>
          </div>
          <div className={styles.relatedLinks}>
            {relatedLinks.map((link) =>
              link.href.startsWith("/") ? (
                <Link href={link.href} key={link.href}>
                  {link.label}
                </Link>
              ) : (
                <a href={link.href} key={link.href}>
                  {link.label}
                </a>
              ),
            )}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerMeta}>
            <Link className={styles.brand} href="/" aria-label="CloseSpan home">
              <CloseSpanLogo size="sm" />
            </Link>
            <p>Customer-reported problem to verified fix.</p>
          </div>
          <nav className={styles.footerLinks} aria-label="Footer navigation">
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/security">Security</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/connectors">Connectors</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/requests">Requests</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
