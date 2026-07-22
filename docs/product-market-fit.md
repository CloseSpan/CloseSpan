# CloseSpan product-market-fit and pricing plan

Updated July 16, 2026. Competitor pricing and positioning can change; recheck the linked primary sources before changing public packaging.

## Decision

CloseSpan is not a free developer utility and should not launch as a broad “AI customer-feedback platform.” Its initial category is **feedback-to-fix operations**: the governed operational layer that turns customer-reported product defects into engineering-ready problems, verified releases, and completed customer follow-up.

The launch promise is:

> Resolve the product problems customers feel before they become churn. CloseSpan groups related reports across support channels, quantifies the accounts and revenue affected, connects the problem to likely engineering ownership and release context, and manages the approval-controlled path to a verified fix.

Feature requests and usability feedback remain classified and searchable, but bugs, regressions, and incidents own the primary workflow until the wedge is proven.

## Why the product must be narrower

The broad feedback category is already crowded:

| Product | Current public position | Implication |
| --- | --- | --- |
| [Canny](https://canny.io/pricing) | AI capture, deduplication, prioritization, roadmap, changelog, and close-loop; free tier and Pro from $79/month annually | Collection and AI deduplication are low-cost table stakes. |
| [Productboard](https://www.productboard.com/pricing/) | Feedback intelligence, prioritization, specs, roadmaps, codebase context, and product agents; Free, $19/maker, and $59/maker tiers | “Feedback to roadmap” is an established category. |
| [Linear Customer Requests](https://linear.app/customer-requests) | Customer requests from support and CRM systems linked to accounts, revenue, issues, and projects | Ticket creation with customer context is increasingly native to delivery tools. |
| [Enterpret](https://www.enterpret.com/pricing) | Cross-channel intelligence, adaptive taxonomy, customer graph, agents, actions, and close-loop workflows; custom data-volume pricing | Competing on more sources, clustering, or AI summaries alone is weak. |
| [unitQ](https://www.unitq.com/products/monitorq/) | Quality intelligence, issue clustering, release context, engineering routing, and root-cause workflows | CloseSpan must win on B2B account context, approvals, verification, and mid-market implementation. |
| [DevRev](https://devrev.ai/pricing) | A broad AI, support, build, and observe platform with a shared knowledge graph | CloseSpan should work above the existing stack without requiring platform replacement. |
| [Zeda.io](https://zeda.io/pricing) | Broad VoC and product suite from $499/month with annual commitment | Mid-market buyers will pay several hundred dollars monthly when business value is clear. |
| [Featurebase](https://www.featurebase.app/pricing) | Combined support and feedback suite with free and $29–$99/seat tiers | Low-end all-in-one feedback/support is also crowded. |

The opening is a persistent evidence graph across feedback → account → product problem → work item → code owner → release → verified outcome. Human approval and resolution labels improve this asset over time; generic embeddings and summaries do not create a moat.

## Initial ideal customer profile

Best fit:

- B2B SaaS with 50–300 employees.
- 5–40 support or customer-success staff and 15–150 engineers.
- At least 1,000 support conversations per month across Intercom or Zendesk plus Slack, email, or calls.
- GitHub with Linear or Jira, multiple repositories, and meaningful release frequency.
- Enterprise or strategic accounts where one recurring defect can affect a renewal, expansion, SLA, or executive escalation.
- A recurring manual escalation process involving support, product, and engineering.

Champion: Head of Support, Support Operations, or Product Operations. Economic buyer: VP Engineering, CTO, Head of Product, or CPO.

Not the initial fit: solo developers, pre-revenue startups, consumer review analytics, generic research repositories, public voting boards, or teams looking primarily for roadmap software.

## Must-win workflow

The first sellable workflow is a complaint spike or recurring defect after a release:

1. Import Intercom or Zendesk feedback.
2. Propose high-precision duplicate clusters.
3. Attach account, ARR, tier, renewal, environment, and severity context.
4. Search existing Jira, Linear, or GitHub work before proposing a new item.
5. Use GitHub and optional Sentry context to identify likely repositories, owners, files, and releases while keeping hypotheses explicit.
6. Produce an engineering-ready evidence pack.
7. Require approval before creating or updating one work item.
8. Associate a release and verify that errors and repeat complaints decline.
9. Draft replies for exactly the affected customer conversations.
10. Record every decision and external action in the audit timeline.

Defer general roadmap planning, public voting portals, autonomous code changes, broad chat, and dozens of shallow connectors until this workflow converts paid customers.

## Launch pricing hypothesis

There is no free production workspace. The free product is an authenticated,
seeded evaluation workspace with no customer data and no external writes.

| Offer | Price | Purpose |
| --- | ---: | --- |
| Authenticated workspace | $0 | Let a buyer inspect the workflow after verified Google sign-in without connecting customer systems. |
| Six-week design-partner pilot | $1,500 one time | Validate one real feedback-to-fix workflow, accuracy, and ROI. Credit the fee toward an annual plan. |
| Expected Team continuation | About $499/month | Starting hypothesis after a successful pilot, with unlimited viewers and predictable feedback-volume limits. |
| Scale | Custom | CRM/observability enrichment, multiple products and repositories, SSO, advanced RBAC, retention, and SLA. |

Do not charge every collaborator. Cross-functional viewer access is part of the product’s value. Use predictable monthly feedback-volume bands and configured hard caps; do not expose model-token billing or surprise auto-upgrades.

Public subscription packaging should remain a hypothesis until at least three paid pilots convert. A future free GitHub app or developer SDK may become an acquisition channel, but the governed organizational workflow remains paid.

## Six-week validation plan

### Week 1: Reconstruct the painful event

Interview 15 people across 10–12 qualified companies: five support leaders, five engineering/product leaders, and five operators. Ask each to reconstruct the last customer-reported defect, tools and people involved, duplicate issues created, time to usable engineering evidence, revenue/SLA impact, verification, and customer follow-up.

Gate: eight companies report the workflow at least monthly and five offer anonymized historical examples.

### Week 2: Sell a concierge feedback-to-fix audit

Using a redacted 30–90 day export and issue/release metadata, manually produce the top defect clusters, existing-work matches, affected accounts, likely owner/release, missing reproduction evidence, and current manual time cost.

Gate: three companies pay for a pilot or sign a credible paid conversion commitment. A free “interesting dashboard” response does not pass.

### Week 3: Shadow mode

Connect one support source and one engineering stack with all external writes disabled.

Targets:

- At least 90% precision for proposed cluster merges.
- At least 85% precision for existing-work matches.
- At least 80% top-three repository or owner accuracy.
- Zero unapproved external writes.

### Week 4: Approved execution

Run at least ten real problem workflows through recommendation, review, one approved work-item action, and audit recording.

Targets: 75% of evidence packs accepted with minor edits and a 50% reduction in median time from first signal to an engineering-ready problem.

### Week 5: Resolution proof

Associate releases, verify complaint or error decline, prepare affected-customer replies, and calculate customer-specific ROI using the buyer’s own labor and revenue assumptions.

Track time to triage, time to engineering-ready, duplicate issues avoided, support escalations per problem, time to verified resolution, follow-up completion, and post-release recurrence.

### Week 6: Conversion test

Offer paid continuation based on measured outcomes.

PMF gate:

- Three of five pilots convert.
- At least two accept an annual or three-month commitment.
- The approved workflow is used more than once by every converted customer.
- At least one VP Engineering or Head of Product describes CloseSpan as the owner of a recurring operational workflow, not merely a useful dashboard.

If support values the evidence but engineering ignores it, narrow to support-escalation quality. If engineering values code-aware investigation but not clustering, reposition as customer-impact triage inside GitHub or Linear. If teams like the dashboard but no buyer owns budget, do not expand the roadmap product.

## Production gates before live pilots

Do not accept unredacted customer data until authentication, tenant isolation, durable PostgreSQL persistence, OAuth token security, deletion/retention workflows, audit export, integration idempotency, and a signed data-processing agreement are operational. Until then, the authenticated evaluation workspace remains simulated and pilot recruitment is a design-partner application rather than self-serve activation.
