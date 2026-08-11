# CloseSpan release verifier

This Cloudflare Worker is the durable queue boundary for production-safe UI verification. It accepts only a small signed job reference, queues it, and invokes CloseSpan's internal Tenki release-verifier endpoint. The application loads the immutable plan and baseline from PostgreSQL, so screenshots and credentials never pass through Cloudflare Queues.

Required secrets:

- `RELEASE_VERIFIER_SHARED_SECRET`
- `RELEASE_VERIFIER_EXECUTOR_URL`
- `RELEASE_VERIFIER_EXECUTOR_SHARED_SECRET`
- `STATUS_PROBE_SECRET`

Create `closespan-release-verifications` and `closespan-release-verifications-dlq`, generate types with `npm run types`, and validate with `npm run check` and `npm run check:deploy`.
