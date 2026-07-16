# FeedbackFlow AI

An evidence-driven B2B SaaS product that turns fragmented customer feedback into a verified product resolution. This repository implements a complete, launchable seeded MVP with explicit simulation boundaries.

The initial go-to-market wedge is **feedback-to-fix operations for mid-market B2B SaaS**: detect repeated customer-reported defects, quantify account and revenue impact, prepare engineering evidence, govern external actions, verify the release, and close the affected customer conversations. See the [product-market-fit and pricing plan](docs/product-market-fit.md).

## Run locally

Requirements: Node.js 20.9 or newer (Node.js 22 LTS recommended).

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the public product landing page, or `http://localhost:3000/overview` to enter the seeded workspace. No credentials are required. Every connector and external work item is clearly marked as simulated.

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
2. Three semantically related reports are associated with a persistent product problem with visible membership confidence.
3. A configurable weighted impact model explains its score with source evidence.
4. The central problem workspace combines customer, environment, business, release, repository, and ownership context.
5. A code-aware investigation presents a hypothesis, uncertainty, assumptions, missing evidence, suspected files, and tests.
6. The proposed GitHub action enters a human approval request with risk, reversibility, systems, and data-sharing scope.
7. Approval creates a simulated work item and records an audit event.
8. The problem can advance through implementation, release, and verification; verification creates follow-up drafts.

The application also includes real routes and interactive seeded experiences for:

- Executive overview and emerging themes
- Unified feedback inbox with search, source filtering, selection, and classification action
- Product-problem cluster inventory and evidence detail
- Explainable prioritization board
- Code-aware investigation queue
- Human approval center
- Integration configuration and health states
- Customer follow-up approval
- Customer/account impact view
- Autonomy, scoring, and data-governance settings

The in-memory store is intentionally demo-only and resets when the server restarts. The domain boundaries and route contracts are shaped for replacement with PostgreSQL and background jobs.

## Repository structure

- `src/app` — Next.js UI and tenant-scoped workflow routes
- `src/components` — product workspace and application navigation
- `src/lib/domain.ts` — core entities and explainable scoring logic
- `src/lib/seed.ts` — realistic, explicitly simulated demonstration dataset
- `src/lib/store.ts` — deterministic demo workflow state
- `docs/architecture` — decisions and production migration plan

## Current limitations

- One seeded organization; no authentication UI yet.
- State is process-local, not durable or safe for multiple instances.
- Classification, embeddings, repository search, and integrations are deterministic simulations.
- No production data should be used with this phase.
- UI configuration state is process- or browser-local and resets between sessions.

## Deployment safety

The application defaults to demo behavior in development. A production Node process defaults to `APP_MODE=production` and rejects mutations until an authenticated trusted proxy is configured. This prevents accidental use of the seeded identity model with real customer data. See [Production readiness contract](docs/production-readiness.md) and [Production architecture](docs/architecture/production-architecture.md).

The repository includes a non-root multi-stage `Dockerfile`, `/api/health`, strict response security headers, and a GitHub Actions quality workflow. Durable PostgreSQL/RLS persistence, OIDC membership enforcement, and real connector credentials remain mandatory gates before accepting real customer data.

See [Production architecture](docs/architecture/production-architecture.md) for the hardening sequence and connector design.
