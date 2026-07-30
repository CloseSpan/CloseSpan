# CloseSpan

An evidence-driven B2B SaaS product that turns fragmented customer feedback into a verified product resolution. This repository implements a complete, launchable seeded MVP with explicit simulation boundaries.

The initial go-to-market wedge is **feedback-to-fix operations for mid-market B2B SaaS**: detect repeated customer-reported defects, quantify account and revenue impact, prepare engineering evidence, govern external actions, verify the release, and close the affected customer conversations. See the [product-market-fit and pricing plan](docs/product-market-fit.md).

## Run locally

Requirements: Node.js 20.9 or newer (Node.js 22 LTS recommended), Docker, and Docker Compose.

```bash
npm install
npm run db:setup
npm run dev
```

`db:setup` starts PostgreSQL 16 with pgvector, applies idempotent SQL migrations, and inserts the explicitly simulated demo tenant. Open `http://localhost:3000` for the public product landing page, or `http://localhost:3000/overview` to enter the seeded workspace. Every connector and external work item is clearly marked as simulated.

### Configure Google sign-in

Google is the only authentication provider. Create an OAuth 2.0 Web
application in Google Cloud and add this local authorized redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

Copy `.env.example` to `.env.local`, then configure:

```bash
AUTH_SECRET=<random 32-byte secret>
AUTH_TRUST_HOST=true
AUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=<Google OAuth client ID>
AUTH_GOOGLE_SECRET=<Google OAuth client secret>
```

Use `openssl rand -hex 32` to generate `AUTH_SECRET`. In production mode, the
Google email must match a row in `workspace_members`; that row supplies the
organization, member ID, display name, and role. Provision the first owner
into an empty organization with:

```bash
PRODUCTION_OWNER_EMAIL=you@company.com \
PRODUCTION_OWNER_NAME="Your Name" \
PRODUCTION_ORG_NAME="CloseSpan" \
npm run db:provision-owner
```

### Configure public email aliases

The public site uses role-based CloseSpan addresses rather than exposing the
private workspace-owner email:

- `hello@closespan.com` for pilots, general questions, and waitlist inquiries
- `support@closespan.com` for product and connector support
- `security@closespan.com` for responsible security reports
- `privacy@closespan.com` for privacy and data-subject requests

Configure these aliases in Cloudflare Email Routing and forward them to the
appropriate monitored mailbox before deploying the public links. Cloudflare
Email Routing handles inbound forwarding only; sending replies from a
`@closespan.com` address requires a separate outbound mail provider. The
private beta owner identity remains controlled separately by application
access policy and `PRODUCTION_OWNER_EMAIL`.

Add the exact production callback
`https://closespan.com/api/auth/callback/google` to the Google OAuth 2.0 Web
client before deployment. Keep
`http://localhost:3000/api/auth/callback/google` for local development.

`AUTH_TRUST_HOST=true` is required for the standalone Docker/reverse-proxy
deployment. Only enable it when the proxy overwrites untrusted
`Host`/`X-Forwarded-Host` headers with the canonical application host.
Set `AUTH_URL` to the exact canonical HTTPS origin in production:

```env
AUTH_URL=https://closespan.com
```

### Configure feature-request voting

The public `/requests` board stores requests and vote counts in PostgreSQL.
Voting is limited to one vote per feature request per network address with a
database uniqueness constraint. CloseSpan never stores raw IP addresses; it
stores a request-scoped HMAC fingerprint instead. Anonymous submissions remain
in `Pending review` until an administrator publishes them. Short-lived,
action-scoped HMAC claims provide a PostgreSQL-backed abuse limit without
linking submissions indefinitely. Set a stable, server-only secret in every
production environment before launch:

```bash
FEATURE_REQUEST_IP_SECRET=<at least 32 random bytes>
FEATURE_REQUEST_MODERATOR_EMAILS=owner@example.com
```

The public mutation endpoints fail closed in production if this dedicated key
is absent. Keep it stable: changing it resets the anonymous voter identity
boundary. Vercel's controlled client-IP header is used automatically. For a
non-Vercel production deployment, `FEATURE_REQUEST_TRUST_PROXY=1` is required,
and the app must be reachable only through a reverse proxy that replaces
`X-Forwarded-For`. Run `npm run db:migrate` after pulling the feature-request
schema. Signed-in allowlisted administrators receive a private review queue on
the public board and can publish or reject submissions; each decision is
idempotent and written to the workspace audit log. `PRODUCTION_OWNER_EMAIL` is
also recognized as a moderator. IP uniqueness is a lightweight abuse control
rather than proof of one human identity; shared networks and VPNs can affect
it.

Cloudflare Turnstile adds a separate browser-verification layer to anonymous
feature-request submissions and votes. Create a **Managed** Turnstile widget,
allow both `closespan.com` and `www.closespan.com`, and validate the canonical
production hostname in Vercel Production:

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public widget site key>
TURNSTILE_SECRET_KEY=<server-only widget secret key>
TURNSTILE_EXPECTED_HOSTNAME=www.closespan.com
```

The server validates every token with Cloudflare Siteverify and requires the
exact request action and hostname before writing to PostgreSQL. Tokens are
single-use, so the browser resets the widget after every attempt. Production
fails closed when any required Turnstile setting is missing and refuses
Cloudflare test secrets. Local development uses Cloudflare's documented
always-pass test keys when no keys are configured; do not copy those test keys
into Vercel. The content security policy allows only Cloudflare's Turnstile
script and challenge frames in addition to existing first-party sources.

### Configure an AI provider

The seeded demo runs without an AI credential. To enable secure bring-your-own-key settings, initialize the server credential vault once in `.env.local` with a random 32-byte key, restart, then open **Settings → AI provider**:

```bash
AI_CREDENTIAL_ENCRYPTION_KEY=<32 random bytes encoded as base64>
```

The settings UI supports xAI Grok, OpenAI, Anthropic Claude, and OpenRouter. Provider keys are encrypted with AES-256-GCM, bound to both the organization and provider, masked in the UI, and never returned to the browser. Environment-managed provider keys remain available as a deployment fallback.

Never commit `.env.local`. AI runs use strict structured output, no tools, PII preprocessing, prompt-injection boundaries, tenant-scoped model-run records, token counts, and an audit event. Cluster changes remain proposals for human review; a model response never merges clusters directly.

### Configure Pipedream Connect

CloseSpan uses [Pipedream Connect](https://pipedream.com/docs/connect) for multi-tenant provider authorization. Each CloseSpan workspace is mapped to a Pipedream external user, while Pipedream stores provider credentials. The browser only receives a short-lived hosted Connect link.

Create a Pipedream Connect project and configure these server-only values in `.env.local` and the deployment environment:

```bash
PIPEDREAM_PROJECT_ID=<project id>
PIPEDREAM_CLIENT_ID=<project OAuth client id>
PIPEDREAM_CLIENT_SECRET=<project OAuth client secret>
PIPEDREAM_PROJECT_ENVIRONMENT=development
```

Use `production` for the production project. CloseSpan opens Pipedream's secure account UI from chat and from the Integrations drawer, polls for verified accounts, supports multiple accounts per provider, and lets workspace admins remove individual accounts. Run `npm run db:migrate` after pulling the connector schema.

### Configure optional public feedback discovery

Public discovery is explicitly opt-in and is separate from authenticated Pipedream
connectors. CloseSpan sends only the product identity or public hostname to
You.com, validates and deduplicates returned public URLs, and labels every
result with confidence and provenance. Enable it server-side with:

```bash
YOU_PUBLIC_DISCOVERY_ENABLED=true
YOU_API_KEY=<You.com API key>
```

Bright Data is represented by an injectable provider boundary but remains
disabled until a dataset-specific scraper is deliberately implemented. No
Bright Data credential or customer connector data is used by the current app.

To run the optimized standalone build in demo mode:

```bash
npm run build
APP_MODE=demo PERSISTENCE_MODE=postgres \
  DEMO_MEMORY_ORG_ID=org_northstar npm start
```

This hybrid local mode keeps only `CloseSpan Demo` in seeded memory. New
organizations, memberships, onboarding progress, feedback, integrations, and
settings are stored in PostgreSQL and survive application restarts.

Verification:

```bash
npm test
npm run typecheck
npm run build
```

### Search and agent discoverability

The public marketing site uses `https://www.closespan.com/` as its search
canonical because the apex domain redirects to `www`. Keep the canonical,
Open Graph URL, structured data, and sitemap aligned with the final
non-redirecting host if that redirect direction changes.

The application publishes these unauthenticated discovery resources:

- `/robots.txt`: allows normal search crawlers plus OpenAI and Anthropic
  search/user agents, while excluding tenant workspace and API paths.
- `/sitemap.xml`: lists only canonical, public, indexable pages.
- `/opengraph-image` and `/favicon-512.png`: branded link-preview and site assets.
- `/manifest.webmanifest`: installable web-application identity.
- `/llms.txt`: an optional factual product brief for systems that choose to
  use the community convention. It is not a Google ranking signal and does not
  replace crawlable HTML, metadata, structured data, or the sitemap.

The homepage includes visible product and FAQ content plus `WebSite`,
`Organization`, `WebApplication`, and matching `FAQPage` JSON-LD. Authenticated
workspace pages remain `noindex`. Optional ownership tokens can be added at
build time with `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION`.

After production deployment, verify the canonical domain in Google Search
Console and Bing Webmaster Tools, then submit
`https://www.closespan.com/sitemap.xml`. Indexing and ranking remain controlled
by each search provider and can take time after a recrawl.

After migrating the local PostgreSQL database, run the real cursor/upsert/delete
integration test with:

```bash
RUN_POSTGRES_INTEGRATION_TESTS=true \
node --env-file-if-exists=.env.local \
./node_modules/vitest/vitest.mjs run \
src/lib/pipedream-repository.reconciliation.test.ts
```

Or run the complete sequential quality gate with `npm run check`. Do not run `next dev` and `next build` concurrently because both own the `.next` output directory.

## Implemented product

1. Seeded Intercom, Zendesk, and Slack feedback is normalized into typed, tenant-scoped records.
2. Three semantically related seeded reports are associated with a persistent product problem with visible membership confidence; configured workspaces can run real multi-provider classification and clustering recommendations.
3. A configurable weighted impact model explains its score with source evidence.
4. The central problem workspace combines customer, environment, business, release, repository, and ownership context.
5. A code-aware investigation presents a hypothesis, uncertainty, assumptions, missing evidence, suspected files, and tests.
6. The proposed GitHub action enters a human approval request with risk, reversibility, systems, and data-sharing scope.
7. Each problem can be expanded into a structured engineering ticket with measurable acceptance criteria and Given/When/Then coverage, then rendered into an immutable SHA-256-addressed `.prompt` revision.
8. A single-use approval can launch one isolated Tenki Sandbox coding run against one allowlisted GitHub repository and exact base commit; successful runs publish two commits and a draft PR without merging or deploying.
9. Automated checks can reach `Tests passed`, while `Verified` remains release-level and requires human-supplied evidence for the current ticket revision.

The application also includes real routes and interactive seeded experiences for:

- Executive overview and emerging themes
- Unified feedback inbox with search, source filtering, selection, and governed AI analysis
- Product-problem cluster inventory and evidence detail
- Explainable prioritization board
- Code-aware investigation queue
- Human approval center
- Integration configuration and health states
- Product-first AI onboarding with connector recommendations
- Optional public-feedback URL discovery with provenance
- Pipedream account authorization and tenant-scoped connection health
- Customer follow-up approval
- Customer/account impact view
- Autonomy, scoring, and data-governance settings

All workspace business data is persisted in PostgreSQL: feedback, problems, account impact, weekly and comparison-period analytics, investigations, approvals, integrations, Pipedream account metadata, members, governance settings, prompt versions, model runs, proposed AI analyses, lifecycle state, idempotency keys, follow-up status, and audit events. Every application route server-renders tenant-scoped database view models. Transactions lock the tenant row so related workflow changes commit atomically. Unit tests select the isolated memory adapter explicitly; the local application uses PostgreSQL through `.env.local`.

## Repository structure

- `src/app`: Next.js UI and tenant-scoped workflow routes
- `src/components`: product workspace and application navigation
- `src/lib/domain.ts`: core entities and explainable scoring logic
- `src/lib/seed.ts`: deterministic test fixtures used only by the memory adapter and unit tests
- `src/lib/store.ts`: persistence adapter boundary
- `src/lib/postgres-store.ts`: transactional PostgreSQL workflow repository
- `src/lib/workspace-repository.ts`: tenant-scoped database view models for application screens
- `src/lib/ai-provider.ts`, `src/lib/ai-config.ts`, and `src/lib/ai-repository.ts`: provider adapters, encrypted configuration, and durable recommendation records
- `src/lib/public-feedback-discovery.ts`: optional You.com public-source discovery and the disabled Bright Data adapter boundary
- `src/lib/pipedream*`: Pipedream Connect client, connector catalog, and tenant-scoped account metadata
- `.prompt`: approved-prompt format, template, and committed ticket artifacts
- `workers/agent-executor`: durable Cloudflare Queue consumer that drives a network-isolated Tenki microVM while keeping the AI credential outside the sandbox
- `db/migrations` and `db/seeds`: idempotent schema and demonstration data
- `docs/architecture`: decisions and production migration plan

## Current limitations

- Workspace switching and tenant-scoped data access are implemented; member invitations and role administration are not yet self-service.
- Google identity and database-backed membership enforcement are enabled, but PostgreSQL row-level-security policies are not enabled yet.
- Feedback classification is real when a supported AI provider key is configured. Pipedream Connect authorization is implemented; provider-specific backfill and continuous import workers still need to be completed before every connector is a live feedback feed. The legacy demo approval still creates a simulated external work item; the engineering-ticket flow uses the separate GitHub App and Tenki-backed executor described below.
- No production data should be used with this phase.
- Non-AI demo policy controls are still browser-local and reset between sessions; AI provider configuration is durable in PostgreSQL.

## Deployment safety

The application defaults to demo behavior in development. A production Node
process defaults to `APP_MODE=production`, requires a signed Google session,
and rejects users whose verified email is not present in `workspace_members`.
See [Production readiness contract](docs/production-readiness.md) and
[Production architecture](docs/architecture/production-architecture.md).

The repository includes durable PostgreSQL persistence, pgvector readiness, a non-root multi-stage `Dockerfile`, a database-aware `/api/health`, Google OIDC membership enforcement, strict response security headers, Pipedream-hosted connector credentials, and a GitHub Actions quality workflow. PostgreSQL RLS, production Pipedream credentials, and provider-specific import workers remain mandatory gates before accepting real customer data.

See [Production architecture](docs/architecture/production-architecture.md) for the hardening sequence and connector design.

## Approval-bound coding executor

Run migrations `022_engineering_prompt_workflow.sql`, `023_workflow_automation.sql`, and `024_github_app_installations.sql`. Configure the GitHub App Setup URL as `https://closespan.com/api/integrations/github/callback` and set `GITHUB_APP_INSTALL_URL=https://github.com/apps/closespan/installations/new`. The authenticated callback verifies the installation with GitHub, binds it to the initiating workspace administrator through a signed one-time attempt, and synchronizes only repositories selected in GitHub. Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `AGENT_EXECUTOR_URL`, `AGENT_EXECUTOR_SHARED_SECRET`, and `CLOSESPAN_INTERNAL_BASE_URL` in the Vercel application.

The Vercel cron calls `/api/internal/workflow/automation` once per minute. Each workspace uses an advisory lock plus a durable 30-second transition lease, so one evidence-qualified ticket can move by only one stage at a time even when cron, an open board, or a retry overlap. `Approved` is the human decision queue; every other transition requires stored evidence and is agent-managed. Configure `CRON_SECRET` in Vercel before enabling the schedule.

The durable queue coordinator is isolated in `workers/agent-executor`; its deployment and secret setup are documented in [its README](workers/agent-executor/README.md). It receives only `TENKI_EXECUTOR_URL`, the shared signing secret, and the status-probe secret. The Node application keeps `OPENAI_API_KEY` and `TENKI_API_KEY`, runs the agent control plane, and sends bounded repository operations to a fresh Tenki microVM with inbound and outbound networking disabled. Verify the coordinator independently with `npm run typecheck:executor`.

After the executor reports success, the application automatically replays the result in a second fresh Tenki microVM before CloseSpan publishes the draft PR. The verifier loads the exact approved base archive, applies only the validated changed files, verifies the prompt hash, and reruns the approved commands with inbound and outbound networking disabled. Configure a repository-specific `TENKI_SANDBOX_IMAGE` or `TENKI_SANDBOX_SNAPSHOT_ID` when tests need an offline dependency environment. Set `TENKI_VERIFICATION_REQUIRED=true` in Vercel to fail closed when verification is unavailable. The implementation and independent replay use the existing one-run approval; the operator is not asked to approve the same work twice.
