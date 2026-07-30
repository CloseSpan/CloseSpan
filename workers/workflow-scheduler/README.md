# CloseSpan workflow scheduler

This Cloudflare Worker invokes CloseSpan's protected workflow coordinator once per minute. It replaces the Vercel Cron declaration because the Vercel Hobby plan supports only daily schedules.

The Worker has no customer-facing mutation API. `GET /health` returns a minimal liveness response; the Cron Trigger is the only path that starts an automation tick.

## Production configuration

- `CLOSESPAN_ORIGIN` is non-secret configuration in `wrangler.jsonc`.
- `CRON_SECRET` is an encrypted Worker secret and must match the Vercel production `CRON_SECRET`.
- Deploy with `npx wrangler deploy --config workers/workflow-scheduler/wrangler.jsonc`.
- Verify with `npm run typecheck:scheduler` and `npx wrangler deploy --dry-run --config workers/workflow-scheduler/wrangler.jsonc`.

The application endpoint independently serializes transitions per workspace, so duplicate or overlapping Cron deliveries cannot advance the same ticket more than one stage per lease.
