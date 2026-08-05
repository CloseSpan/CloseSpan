# CloseSpan agent executor

This Worker accepts HMAC-signed, single-run jobs from CloseSpan, stores them in a durable Cloudflare Queue, and forwards one job at a time to CloseSpan's Node-based Tenki executor. The Worker never receives GitHub, OpenAI, or Tenki credentials.

## Configure

The permanent Worker is named `closespan-agent-tenki-proxy`. Do not deploy this source over
the legacy `closespan-agent-executor` Sandbox Worker because that service owns existing
Durable Object and container migrations.

```bash
npm install
npm run types
npx wrangler secret put TENKI_EXECUTOR_URL
npx wrangler secret put AGENT_EXECUTOR_SHARED_SECRET
npx wrangler secret put STATUS_PROBE_SECRET
```

Use the same high-entropy `AGENT_EXECUTOR_SHARED_SECRET` in the Vercel application. Set `TENKI_EXECUTOR_URL` to `https://www.closespan.com/api/internal/tenki-executor` (or the matching deployment origin). The endpoint validates the signed job, atomically claims the queued run, and ignores duplicate delivery.

Create the queue named `closespan-agent-runs` before the first deployment, then deploy from this directory with `npx wrangler deploy`. Configure `OPENAI_API_KEY`, `TENKI_API_KEY`, and an optional repository-specific `TENKI_SANDBOX_IMAGE` or `TENKI_SANDBOX_SNAPSHOT_ID` in Vercel, not in this Worker.

## Verify

```bash
npm run types
npx tsc --noEmit
npm run check
npm run check:deploy
```

The Node executor permits only read-only inspection commands and exact approved validation commands. Every Tenki session is created with inbound and outbound networking disabled, and execution fails closed if the returned session does not preserve that policy. The executor also rejects protected/out-of-scope files, symlinks, binary or oversized diffs, changed prompt bytes, incomplete criteria, and failed commands before returning evidence to CloseSpan. Every session is explicitly terminated and cleanup failure is reported as a failed run.
