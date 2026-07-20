# FeedbackFlow AI

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
- Customer follow-up approval
- Customer/account impact view
- Autonomy, scoring, and data-governance settings

All workspace business data is persisted in PostgreSQL: feedback, problems, account impact, weekly and comparison-period analytics, investigations, approvals, integrations, members, governance settings, prompt versions, model runs, proposed AI analyses, lifecycle state, idempotency keys, follow-up status, and audit events. Every application route server-renders tenant-scoped database view models. Transactions lock the tenant row so related workflow changes commit atomically. Unit tests select the isolated memory adapter explicitly; the local application uses PostgreSQL through `.env.local`.

## Repository structure

- `src/app` — Next.js UI and tenant-scoped workflow routes
- `src/components` — product workspace and application navigation
- `src/lib/domain.ts` — core entities and explainable scoring logic
- `src/lib/seed.ts` — deterministic test fixtures used only by the memory adapter and unit tests
- `src/lib/store.ts` — persistence adapter boundary
- `src/lib/postgres-store.ts` — transactional PostgreSQL workflow repository
- `src/lib/workspace-repository.ts` — tenant-scoped database view models for application screens
- `src/lib/ai-provider.ts`, `src/lib/ai-config.ts`, and `src/lib/ai-repository.ts` — provider adapters, encrypted configuration, and durable recommendation records
- `db/migrations` and `db/seeds` — idempotent schema and demonstration data
- `docs/architecture` — decisions and production migration plan

## Current limitations

- One seeded organization; multi-workspace selection and invitations are not implemented yet.
- Google identity and database-backed membership enforcement are enabled, but PostgreSQL row-level-security policies are not enabled yet.
- Feedback classification is real when a supported provider key is configured; embeddings, repository search, and external integrations remain deterministic simulations.
- No production data should be used with this phase.
- Non-AI demo policy controls are still browser-local and reset between sessions; AI provider configuration is durable in PostgreSQL.

## Deployment safety

The application defaults to demo behavior in development. A production Node
process defaults to `APP_MODE=production`, requires a signed Google session,
and rejects users whose verified email is not present in `workspace_members`.
See [Production readiness contract](docs/production-readiness.md) and
[Production architecture](docs/architecture/production-architecture.md).

The repository includes durable PostgreSQL persistence, pgvector readiness, a non-root multi-stage `Dockerfile`, a database-aware `/api/health`, Google OIDC membership enforcement, strict response security headers, and a GitHub Actions quality workflow. PostgreSQL RLS, encrypted connector tokens, and real connector credentials remain mandatory gates before accepting real customer data.

See [Production architecture](docs/architecture/production-architecture.md) for the hardening sequence and connector design.
