import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleDollarSign,
  GitBranch,
  Menu,
  Network,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
} from "lucide-react";
import { launchPlans, launchPricingNote } from "@/lib/plans";

export const metadata: Metadata = {
  title: {
    absolute: "Feelow AI | Turn customer signals into verified product fixes",
  },
  description:
    "Detect revenue-impacting customer problems, prepare engineering-ready evidence, and verify every resolution with Feelow AI.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Feelow AI | Turn customer signals into verified product fixes",
    description:
      "Connect support evidence, revenue impact, engineering context, human approval, and customer follow-up in one governed workflow.",
    siteName: "Feelow AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Feelow AI | Turn customer signals into verified product fixes",
    description:
      "From scattered customer reports to one prioritized, engineering-ready, verified resolution.",
  },
};

const pilotHref =
  "mailto:shanmukhsain@gmail.com?subject=Feelow%20AI%20Design%20Partner%20Pilot";

const integrations = [
  "Intercom",
  "Zendesk",
  "Slack",
  "GitHub",
  "Linear",
  "Jira",
  "Sentry",
  "PostHog",
];

const outcomes = [
  {
    icon: Network,
    eyebrow: "Detect",
    title: "See one problem—not 30 disconnected tickets.",
    text: "Group differently worded reports into a persistent problem with visible evidence, confidence, and release context.",
    metric: "3 reports → 1 problem",
  },
  {
    icon: CircleDollarSign,
    eyebrow: "Prioritize",
    title: "Rank by customer and revenue impact.",
    text: "Replace vote counts with affected ARR, renewal risk, account tier, severity, SLA, frequency, and confidence.",
    metric: "$394k ARR surfaced",
  },
  {
    icon: GitBranch,
    eyebrow: "Resolve",
    title: "Hand engineering evidence, not a vague summary.",
    text: "Connect the customer problem to likely owners, repositories, files, releases, tests, and existing work.",
    metric: "4 evidence types linked",
  },
];

const workflow = [
  {
    number: "01",
    title: "Listen everywhere",
    text: "Normalize and redact signals from support, calls, reviews, and team conversations.",
  },
  {
    number: "02",
    title: "Find the real problem",
    text: "Cluster related reports and keep every membership decision inspectable.",
  },
  {
    number: "03",
    title: "Prepare the fix",
    text: "Score impact, investigate likely causes, and route external actions through approval.",
  },
  {
    number: "04",
    title: "Prove it worked",
    text: "Verify the release, close affected conversations, and watch complaint volume decline.",
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-content">
        Skip to content
      </a>

      <div className="landing-top">
        <header className="landing-nav">
          <Link className="landing-brand" href="/" aria-label="Feelow AI home">
            <span className="brandmark" aria-hidden="true">
              F
            </span>
            <strong>Feelow AI</strong>
          </Link>
          <nav aria-label="Landing navigation">
            <a href="#product">Product</a>
            <a href="#workflow">How it works</a>
            <a href="#trust">Trust</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="landing-actions">
            <Link className="btn landing-secondary" href="/overview">
              View sandbox
            </Link>
            <a className="btn primary" href={pilotHref}>
              Apply for pilot <ArrowRight aria-hidden="true" size={14} />
            </a>
            <details className="landing-mobile-menu">
              <summary aria-label="Open navigation">
                <Menu aria-hidden="true" size={18} />
              </summary>
              <nav aria-label="Mobile navigation">
                <a href="#product">Product</a>
                <a href="#workflow">How it works</a>
                <a href="#trust">Trust</a>
                <a href="#pricing">Pricing</a>
                <Link href="/overview">View sandbox</Link>
              </nav>
            </details>
          </div>
        </header>

        <section className="landing-hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <Sparkles aria-hidden="true" size={14} />
              Feedback-to-fix operations for B2B SaaS
            </div>
            <h1>
              Turn customer signals into <span>verified product fixes.</span>
            </h1>
            <p>
              Feelow AI connects support evidence, revenue impact, engineering
              context, human approval, and customer follow-up in one governed
              workflow.
            </p>
            <div className="hero-actions">
              <a className="btn primary large" href={pilotHref}>
                Apply for a design-partner pilot
                <ArrowRight aria-hidden="true" size={16} />
              </a>
              <Link className="btn large landing-secondary" href="/overview">
                Explore the sandbox
              </Link>
            </div>
            <div className="hero-proof" aria-label="Product safeguards">
              <span>
                <Check aria-hidden="true" size={14} /> Human approval by default
              </span>
              <span>
                <Check aria-hidden="true" size={14} /> Evidence stays inspectable
              </span>
              <span>
                <Check aria-hidden="true" size={14} /> Simulated sandbox available
              </span>
            </div>
          </div>

          <ProductPreview />
        </section>

        <div className="hero-sandbox-proof" aria-label="Seeded sandbox snapshot">
          <span>Seeded sandbox snapshot</span>
          <div>
            <strong>5</strong>
            <small>feedback signals</small>
          </div>
          <div>
            <strong>4</strong>
            <small>tracked problems</small>
          </div>
          <div>
            <strong>$1.32m</strong>
            <small>affected ARR modeled</small>
          </div>
          <div>
            <strong>100%</strong>
            <small>actions governed</small>
          </div>
        </div>
      </div>

      <main id="landing-content">
        <section className="landing-trustbar" aria-label="Designed to connect with">
          <span>Designed to work above your existing stack</span>
          {integrations.map((item) => (
            <strong key={item}>{item}</strong>
          ))}
        </section>

        <section className="landing-section" id="product">
          <div className="section-intro">
            <span>One operational record</span>
            <h2>Own the gap between customer pain and engineering action.</h2>
            <p>
              Every signal remains connected to the problem it revealed, the
              business impact it created, the decision your team made, and the
              outcome your customer experienced.
            </p>
          </div>
          <div className="outcome-grid">
            {outcomes.map(({ icon: Icon, eyebrow, title, text, metric }) => (
              <article key={title}>
                <div className="outcome-card-top">
                  <div className="outcome-icon">
                    <Icon aria-hidden="true" size={20} />
                  </div>
                  <span>{eyebrow}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                <div className="outcome-metric">{metric}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="signal-story" aria-label="From noise to resolution">
          <div className="signal-story-copy">
            <span className="section-label">The must-win moment</span>
            <h2>A release ships. Complaints spike. Every team sees only a fragment.</h2>
            <p>
              Feelow AI gives product, engineering, support, and success one
              shared source of truth before a recurring defect becomes a lost
              renewal.
            </p>
            <Link className="text-link" href="/problems/prob_export">
              Open the seeded problem workspace
              <ChevronRight aria-hidden="true" size={15} />
            </Link>
          </div>
          <div className="signal-story-flow">
            <div className="signal-source-list">
              {["Intercom · export is blank", "Zendesk · zero-byte CSV", "Slack · large export failed"].map(
                (item, index) => (
                  <div key={item}>
                    <span>{index + 1}</span>
                    <strong>{item}</strong>
                  </div>
                ),
              )}
            </div>
            <div className="signal-connector" aria-hidden="true">
              <span />
              <Network size={19} />
              <span />
            </div>
            <div className="signal-result-card">
              <small>Persistent problem · 92% confidence</small>
              <strong>Large CSV exports produce empty files</strong>
              <div>
                <span>$394k ARR</span>
                <span>High severity</span>
              </div>
            </div>
          </div>
        </section>

        <section className="workflow-section" id="workflow">
          <div className="section-intro">
            <span>Signal → resolution</span>
            <h2>One continuous, governed workflow.</h2>
            <p>
              Automate the repetitive coordination while keeping meaningful
              decisions in human hands.
            </p>
          </div>
          <div className="workflow-track">
            {workflow.map((item) => (
              <article className="workflow-step" key={item.number}>
                <span>{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <div className="workflow-summary">
            <article>
              <TimerReset aria-hidden="true" size={22} />
              <div>
                <strong>Detect earlier</strong>
                <p>Surface emerging clusters and release-linked complaint spikes.</p>
              </div>
            </article>
            <article>
              <Users aria-hidden="true" size={22} />
              <div>
                <strong>Decide together</strong>
                <p>Give every team the same customer and technical evidence.</p>
              </div>
            </article>
            <article>
              <BadgeCheck aria-hidden="true" size={22} />
              <div>
                <strong>Prove the outcome</strong>
                <p>Verify the release and close every affected conversation.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="trust-section" id="trust">
          <div>
            <span className="section-label">Trust by design</span>
            <h2>AI recommendations you can inspect—and refuse.</h2>
            <p>
              Customer content is evidence, never agent instruction. Confidence,
              assumptions, affected systems, shared data, and reversibility stay
              visible before every meaningful action.
            </p>
            <ul>
              <li>
                <Check aria-hidden="true" size={15} /> Configurable human approval
              </li>
              <li>
                <Check aria-hidden="true" size={15} /> PII detection and redaction
              </li>
              <li>
                <Check aria-hidden="true" size={15} /> Tenant-scoped audit events
              </li>
              <li>
                <Check aria-hidden="true" size={15} /> Idempotent workflow actions
              </li>
            </ul>
          </div>
          <ApprovalPreview />
        </section>

        <section className="pricing-section" id="pricing">
          <div className="section-intro">
            <span>Early-access pricing</span>
            <h2>Free to evaluate. Paid when it owns a real workflow.</h2>
            <p>
              Explore the sandbox, then prove accuracy and operational ROI in one
              tightly scoped design-partner pilot.
            </p>
          </div>
          <div className="pricing-grid">
            {launchPlans.map((plan) => (
              <article className={plan.featured ? "featured" : ""} key={plan.id}>
                {plan.featured && <span className="pricing-flag">Recommended</span>}
                <div className="pricing-name">{plan.name}</div>
                <div className="pricing-price">{plan.price}</div>
                <div className="pricing-cadence">{plan.cadence}</div>
                <p>{plan.description}</p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Check aria-hidden="true" size={14} />
                      {feature}
                    </li>
                  ))}
                </ul>
                {plan.href.startsWith("/") ? (
                  <Link className={`btn ${plan.featured ? "primary" : ""}`} href={plan.href}>
                    {plan.callToAction}
                  </Link>
                ) : (
                  <a className={`btn ${plan.featured ? "primary" : ""}`} href={plan.href}>
                    {plan.callToAction}
                  </a>
                )}
              </article>
            ))}
          </div>
          <p className="pricing-note">
            {launchPricingNote} Usage caps stop processing instead of triggering
            surprise upgrades.
          </p>
        </section>

        <section className="landing-cta">
          <div>
            <span>Start with evidence</span>
            <h2>See one customer defect move from signal to verified resolution.</h2>
            <p>
              Explore the simulated workspace now, or apply for a design-partner
              pilot built around one high-value workflow.
            </p>
          </div>
          <div className="landing-cta-actions">
            <a className="btn primary large" href={pilotHref}>
              Apply for pilot <ArrowRight aria-hidden="true" size={16} />
            </a>
            <Link className="btn large" href="/overview">
              Explore sandbox
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Link className="landing-brand" href="/">
          <span className="brandmark" aria-hidden="true">
            F
          </span>
          <strong>Feelow AI</strong>
        </Link>
        <p>Customer-reported problem to verified fix.</p>
        <div>
          <Link href="/overview">Sandbox</Link>
          <a href="#pricing">Pricing</a>
          <a href="#trust">Trust</a>
          <a href="mailto:shanmukhsain@gmail.com">Contact</a>
        </div>
      </footer>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="hero-product" aria-label="Feelow AI problem workspace preview">
      <div className="preview-chrome">
        <div className="preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span>Problem workspace · FF-142</span>
        <span className="preview-status">Needs review</span>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar" aria-label="Preview navigation">
          <div className="preview-logo">F</div>
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <i key={item} />
          ))}
        </aside>
        <div className="preview-content">
          <div className="preview-title-row">
            <div>
              <div className="preview-eyebrow">HIGH-IMPACT PROBLEM</div>
              <h2>Large CSV exports produce empty files</h2>
              <p>3 corroborating reports after release 4.18.2</p>
            </div>
            <span>92% confidence</span>
          </div>
          <div className="preview-metrics">
            <div>
              <small>Affected revenue</small>
              <strong>$394k ARR</strong>
            </div>
            <div>
              <small>Accounts</small>
              <strong>3 enterprise</strong>
            </div>
            <div>
              <small>Priority score</small>
              <strong>79 / 100</strong>
            </div>
          </div>
          <div className="preview-grid">
            <section>
              <div className="preview-section-title">Supporting evidence</div>
              {["Intercom · Northstar Labs", "Zendesk · Acme Health", "Slack · Atlas Cloud"].map(
                (item, index) => (
                  <div className="preview-evidence" key={item}>
                    <span>{96 - index * 4}%</span>
                    <div>
                      <strong>{item}</strong>
                      <i />
                    </div>
                  </div>
                ),
              )}
            </section>
            <section>
              <div className="preview-section-title">Recommended next step</div>
              <div className="preview-recommendation">
                <Sparkles aria-hidden="true" size={14} />
                <strong>Investigate export stream finalization</strong>
                <p>2 suspected files · 3 evidence gaps</p>
              </div>
              <div className="preview-approval">
                <BadgeCheck aria-hidden="true" size={15} />
                <span>
                  <strong>Human approval required</strong>
                  <small>GitHub issue · Low risk</small>
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalPreview() {
  return (
    <div className="trust-card">
      <div className="trust-card-head">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>Proposed action</strong>
          <small>Create GitHub issue in analytics-api</small>
        </div>
        <span>Low risk</span>
      </div>
      <dl>
        <div>
          <dt>Reason</dt>
          <dd>3 corroborating reports affecting $394k ARR</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>68% · hypothesis, not confirmed cause</dd>
        </div>
        <div>
          <dt>Data shared</dt>
          <dd>Redacted quotes and environment metadata</dd>
        </div>
        <div>
          <dt>Reversible</dt>
          <dd>Yes · issue can be edited or closed</dd>
        </div>
      </dl>
      <div className="trust-card-actions">
        <button type="button" disabled>
          Reject
        </button>
        <button type="button" disabled>
          Approve simulated action
        </button>
      </div>
    </div>
  );
}
