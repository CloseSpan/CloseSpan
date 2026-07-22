# Production readiness contract

Closespan has two explicit operating modes.

## Demo mode

`APP_MODE=demo` uses realistic seeded data, organization-isolated in-process state, and simulated adapters. The UI labels this mode prominently. No production credentials or customer data may be used. Development defaults to this mode.

## Production mode

`APP_MODE=production` uses Auth.js with Google as the only identity provider.
Production Node processes default to this mode when `APP_MODE` is omitted.
Every workspace page and application API requires a signed session backed by
a verified Google email. The email must match `workspace_members`; the
database row supplies the trusted organization, actor ID, display name, and
role. Client-provided identity headers are not trusted. AI credential
mutations additionally require the database-backed `Admin` role.

This guard prevents accidental deployment of the demo identity model.
PostgreSQL persistence and OIDC membership enforcement are implemented, but
application tenant filters are not a substitute for the target PostgreSQL RLS
policies described in `production-architecture.md`.

## Release gates

- `npm ci && npm run check`
- Store `AUTH_SECRET` and `AUTH_GOOGLE_SECRET` in KMS/Secrets Manager, and
  register `https://closespan.com/api/auth/callback/google` as an authorized
  redirect URI on the Google OAuth 2.0 Web client.
- Set `AUTH_TRUST_HOST=true` only behind a proxy that overwrites inbound
  `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` values with trusted
  canonical values. Set `AUTH_URL=https://closespan.com` in production.
- Confirm every authorized production email has one intended
  `workspace_members` row and the minimum required role.
- Build the multi-stage Docker image as a non-root user.
- Verify `/api/health` behind the load balancer.
- Inject secrets from KMS; never environment files baked into the image.
- Store `AI_CREDENTIAL_ENCRYPTION_KEY` in KMS/Secrets Manager, restrict access to the application runtime identity, and document rotation. Never store it beside encrypted provider credentials.
- Confirm every enabled provider's data-retention terms for the deployment region. OpenAI and xAI Responses calls disable provider-side response storage; Anthropic and OpenRouter use their documented structured-output boundaries.
- Confirm AI requests use structured outputs, no model tools, bounded input/output, redaction, tenant-scoped model-run records, and human review for cluster changes.
- Confirm CSP, HSTS, frame, MIME, referrer, and permissions headers.
- Run `npm run db:migrate` as a separate one-shot deployment job before rolling out application instances. Run `db:seed` only in demonstration environments.
- Exercise approval idempotency, cross-tenant denial, rollback, and audit export in staging.
- Verify backup restore and tenant deletion before accepting customer data.
