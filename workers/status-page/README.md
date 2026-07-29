# CloseSpan status page

Independent Cloudflare Worker and React status application for
`https://uptime.closespan.com`. The Worker serves the static UI, handles public
and administrative APIs, runs minute-level probes, and stores monitoring data
in D1.

## Local development

```sh
npm install
npm run db:migrate:local
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars` and set local-only values before testing
protected component or administrator endpoints. Never commit `.dev.vars`.

## Production configuration

The Worker expects these secrets:

- `STATUS_PROBE_SECRET`: shared bearer credential for protected CloseSpan and
  executor health checks.
- `CF_ACCESS_TEAM_DOMAIN`: Cloudflare Access team domain, without a path.
- `CF_ACCESS_AUD`: Access application audience for `/admin*` and `/api/admin/*`.
- `STATUS_ADMIN_EMAILS`: comma-separated operator email allowlist.
- `STATUS_WEBHOOK_URL`: optional Slack/Discord-compatible operational webhook.

The same `STATUS_PROBE_SECRET` must be configured in the CloseSpan Vercel app
and the `closespan-agent-executor` Worker. Email alerts use the restricted
`STATUS_EMAIL` binding with `status@closespan.com`; the domain must be onboarded
for Cloudflare Email Sending before delivery succeeds.

## Release order

1. Deploy the protected application and executor health endpoints.
2. Create D1, replace the database ID in `wrangler.jsonc`, and apply migrations.
3. Configure Cloudflare Access and Worker secrets.
4. Build and deploy this Worker. Its custom-domain route provisions
   `uptime.closespan.com` and TLS through Cloudflare.
5. Verify `/api/health`, `/api/status`, Access protection, notification delivery,
   and the first scheduled probe.

Monitoring begins with the first production Cron execution. The UI deliberately
shows `No data` for dates before that point; no uptime history or incidents are
seeded.
