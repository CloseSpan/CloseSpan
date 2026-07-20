# Feelow AI

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
PRODUCTION_ORG_NAME="Feelow AI" \
npm run db:provision-owner
```

Add the production callback
`https://your-domain.example/api/auth/callback/google` in Google Cloud before
deployment.

`AUTH_TRUST_HOST=true` is required for the standalone Docker/reverse-proxy
deployment. Only enable it when the proxy overwrites untrusted
`Host`/`X-Forwarded-Host` headers with the canonical application host.
Set `AUTH_URL` to the exact canonical HTTPS origin in production.

### Configure an AI provider

The seeded demo runs without an AI credential. To enable secure bring-your-own-key settings, initialize the server credential vault once in `.env.local` with a random 32-byte key, restart, then open **Settings → AI provider**:

```bash
AI_CREDENTIAL_ENCRYPTION_KEY=<32 random bytes encoded as base64>
```

The settings UI supports xAI Grok, OpenAI, Anthropic Claude, and OpenRouter. Provider keys are encrypted with AES-256-GCM, bound to both the organization and provider, masked in the UI, and never returned to the browser. Environment-managed provider keys remain available as a deployment fallback.

Never commit `.env.local`. AI runs use strict structured output, no tools, PII preprocessing, prompt-injection boundaries, tenant-scoped model-run records, token counts, and an audit event. Cluster changes remain proposals for human review; a model response never merges clusters directly.

### Configure Nango connectors

Feelow uses [Nango](https://nango.dev) for tenant-safe connector authorization. Nango holds the third-party OAuth credentials; Feelow stores only tenant-scoped connection metadata and accepts connection state only from signed Nango webhooks. The browser receives a short-lived Connect session token and never receives the Nango API key or a provider secret.

Create the Zendesk, Intercom, Slack, App Store, Play Store, and GitHub integrations in the appropriate Nango environment. Their Nango **Unique Keys** must match these values in `.env.local` and in the corresponding deployment environment:

```bash
NANGO_API_KEY=<Nango API key for this environment>
NANGO_WEBHOOK_SIGNING_KEY=<separate webhook signing key>
NANGO_ENVIRONMENT=DEV
NANGO_ZENDESK_INTEGRATION_ID=zendesk
NANGO_INTERCOM_INTEGRATION_ID=intercom
NANGO_SLACK_INTEGRATION_ID=slack
NANGO_APP_STORE_INTEGRATION_ID=apple-app-store
NANGO_GOOGLE_PLAY_INTEGRATION_ID=google-play
NANGO_GITHUB_INTEGRATION_ID=github-getting-started
```

`NANGO_ENVIRONMENT` must match the selected Nango environment name (for example `DEV`, `PROD`, or `STAGING`); Feelow normalizes it to uppercase and rejects mismatched webhook environments.

`NANGO_HOST` is optional for Nango Cloud and should only be set to the API origin of a self-hosted Nango instance. The server also recognizes the older environment-specific `NANGO_SECRET_KEY_<ENVIRONMENT>` variables (for example `NANGO_SECRET_KEY_DEV`) for compatibility, but new deployments should use `NANGO_API_KEY`.

In the Nango dashboard, set the webhook destination to:

```text
https://your-domain.example/api/integrations/nango/webhook
```

Copy that environment's webhook signing key into `NANGO_WEBHOOK_SIGNING_KEY`; it is not the API key. For local webhook testing, use an HTTPS tunnel and temporarily point the Nango development environment at the tunnel URL. Run `npm run db:migrate` after pulling the connector schema. Only workspace admins can create Connect sessions, provider keys are selected from a server allowlist, and the signed webhook—not the browser completion event—is authoritative.

Completing OAuth establishes the connection metadata. Continuous feedback ingestion and provider-specific sync schedules are a separate worker concern and must be enabled before treating a connector as a live feedback feed.

For each feedback integration, deploy a Nango sync that emits records with a
stable `id` and at least one feedback field such as `body`, `content`, `text`,
`description`, `review`, or `comment`. Successful signed sync webhooks create a
tenant-scoped PostgreSQL job. A bounded post-response worker retrieves Nango
records by cursor, normalizes them into `feedback_items`, and stores cursor and
receipt checkpoints atomically. Deleted Nango records remove the corresponding
feedback item. Provider errors are reduced to safe status codes and retried with
bounded exponential backoff.

Set a random worker secret in local and deployed environments:

```bash
CRON_SECRET=<at least 16 random characters>
```

`vercel.json` runs `/api/cron/nango-sync` once daily as a recovery sweep that is
compatible with Vercel Hobby. Normal imports start immediately after a signed
Nango sync webhook. The post-response worker makes several bounded, fair claims
inside the 60-second route budget, so a large paginated import continues without
waiting for the recovery cron while other ready streams still receive a turn.

The protected cron endpoint is also the supported entry point for an external
worker scheduler. Invoke it every 1–5 minutes for a minute-level retry SLA (for
example from Vercel Pro cron or existing worker hosting):

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://your-feelow-host/api/cron/nango-sync
```

The route uses database leases, so overlapping invocations cannot process one
connector stream concurrently. On Hobby without another scheduler, a delayed
retry is picked up by a later Nango webhook or by the daily recovery sweep. Its
exact `nextAttemptAt` remains visible through the integration sync-status API.

### Configure optional public feedback discovery

Public discovery is explicitly opt-in and is separate from authenticated Nango
connectors. Feelow sends only the product identity or public hostname to
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
APP_MODE=demo npm start
```

Verification:

```bash
npm test
npm run typecheck
npm run build
```

After migrating the local PostgreSQL database, run the real cursor/upsert/delete
integration test with:

```bash
RUN_POSTGRES_INTEGRATION_TESTS=true \
node --env-file-if-exists=.env.local \
./node_modules/vitest/vitest.mjs run \
src/lib/nango-sync-postgres.integration.test.ts
```

Or run the complete sequential quality gate with `npm run check`. Do not run `next dev` and `next build` concurrently because both own the `.next` output directory.

## Implemented product

1. Seeded Intercom, Zendesk, and Slack feedback is normalized into typed, tenant-scoped records.
2. Three semantically related seeded reports are associated with a persistent product problem with visible membership confidence; configured workspaces can run real multi-provider classification and clustering recommendations.
3. A configurable weighted impact model explains its score with source evidence.
4. The central problem workspace combines customer, environment, business, release, repository, and ownership context.
5. A code-aware investigation presents a hypothesis, uncertainty, assumptions, missing evidence, suspected files, and tests.
6. The proposed GitHub action enters a human approval request with risk, reversibility, systems, and data-sharing scope.
7. Approval creates a simulated work item and records an audit event.
8. The problem can advance through implementation, release, and verification; verification creates follow-up drafts.

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
- Nango import progress for queued, running, retrying, completed, and failed jobs
- Customer follow-up approval
- Customer/account impact view
- Autonomy, scoring, and data-governance settings

All workspace business data is persisted in PostgreSQL: feedback, problems, account impact, weekly and comparison-period analytics, investigations, approvals, integrations, Nango connection metadata, sync jobs, cursors, record receipts, members, governance settings, prompt versions, model runs, proposed AI analyses, lifecycle state, idempotency keys, follow-up status, and audit events. Every application route server-renders tenant-scoped database view models. Transactions lock the tenant row so related workflow changes commit atomically. Unit tests select the isolated memory adapter explicitly; the local application uses PostgreSQL through `.env.local`.

## Repository structure

- `src/app` — Next.js UI and tenant-scoped workflow routes
- `src/components` — product workspace and application navigation
- `src/lib/domain.ts` — core entities and explainable scoring logic
- `src/lib/seed.ts` — deterministic test fixtures used only by the memory adapter and unit tests
- `src/lib/store.ts` — persistence adapter boundary
- `src/lib/postgres-store.ts` — transactional PostgreSQL workflow repository
- `src/lib/workspace-repository.ts` — tenant-scoped database view models for application screens
- `src/lib/ai-provider.ts`, `src/lib/ai-config.ts`, and `src/lib/ai-repository.ts` — provider adapters, encrypted configuration, and durable recommendation records
- `src/lib/public-feedback-discovery.ts` — optional You.com public-source discovery and the disabled Bright Data adapter boundary
- `src/lib/nango-sync-*` — safe record normalization, durable PostgreSQL jobs/cursors, and bounded background workers
- `db/migrations` and `db/seeds` — idempotent schema and demonstration data
- `docs/architecture` — decisions and production migration plan

## Current limitations

- One seeded organization; multi-workspace selection and invitations are not implemented yet.
- Google identity and database-backed membership enforcement are enabled, but PostgreSQL row-level-security policies are not enabled yet.
- Feedback classification is real when a supported AI provider key is configured. Nango OAuth and cursor-based ingestion are implemented, but every provider still requires its Nango integration and sync function to be configured in the selected Nango environment. Embeddings, repository search, and external work creation remain incomplete or simulated.
- No production data should be used with this phase.
- Non-AI demo policy controls are still browser-local and reset between sessions; AI provider configuration is durable in PostgreSQL.

## Deployment safety

The application defaults to demo behavior in development. A production Node
process defaults to `APP_MODE=production`, requires a signed Google session,
and rejects users whose verified email is not present in `workspace_members`.
See [Production readiness contract](docs/production-readiness.md) and
[Production architecture](docs/architecture/production-architecture.md).

The repository includes durable PostgreSQL persistence, pgvector readiness, a non-root multi-stage `Dockerfile`, a database-aware `/api/health`, Google OIDC membership enforcement, strict response security headers, Nango-hosted OAuth credentials with signed webhook reconciliation, leased background ingestion, and a GitHub Actions quality workflow. PostgreSQL RLS and production configuration of each Nango sync remain mandatory gates before accepting real customer data.

See [Production architecture](docs/architecture/production-architecture.md) for the hardening sequence and connector design.
