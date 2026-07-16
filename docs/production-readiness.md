# Production readiness contract

FeedbackFlow has two explicit operating modes.

## Demo mode

`APP_MODE=demo` uses realistic seeded data, organization-isolated in-process state, and simulated adapters. The UI labels this mode prominently. No production credentials or customer data may be used. Development defaults to this mode.

## Production mode

`APP_MODE=production` fails closed for mutating API calls unless an authenticated trusted proxy is configured with `AUTH_TRUSTED_PROXY=true` and `TRUSTED_PROXY_SECRET`. Production Node processes default to this mode when `APP_MODE` is omitted. The proxy must strip all inbound identity headers, verify an OIDC session and authorization policy, and then supply authenticated user and organization headers.

This guard prevents accidental deployment of the demo identity model. It is not a substitute for the target PostgreSQL/RLS persistence and OIDC membership implementation described in `production-architecture.md`.

## Release gates

- `npm ci && npm run check`
- Build the multi-stage Docker image as a non-root user.
- Verify `/api/health` behind the load balancer.
- Inject secrets from KMS; never environment files baked into the image.
- Confirm CSP, HSTS, frame, MIME, referrer, and permissions headers.
- Run database migrations as a separate one-shot job once persistence is enabled.
- Exercise approval idempotency, cross-tenant denial, rollback, and audit export in staging.
- Verify backup restore and tenant deletion before accepting customer data.
