# App subdomain cutover

## Address layout

- `closespan.com` / `www.closespan.com`: existing public website. The existing
  canonical URL remains `https://www.closespan.com`; this change does not migrate SEO URLs.
- `app.closespan.com`: login, onboarding, workspace and admin pages. `/` opens
  `/overview`. Public pages route back to the website. `/requests` on the app opens
  the moderator-only `/admin/requests`; public submissions and voting remain on the website.
- Localhost and Vercel preview hostnames remain single-host applications.

One repository and one Vercel project serve both hosts. This is domain routing,
not separate deployments or a new security boundary by itself.

## Rollout switch

`CLOSESPAN_APP_DOMAIN_ENABLED` defaults to off and must equal `true` to enable
navigation redirects. Set it only in the coordinated production deployment after
DNS, HTTPS and OAuth settings are ready. Do not change the local `.env` auth URL:
development stays at `http://localhost:3000`.

The redirects run before Auth.js (which normalizes URLs using `AUTH_URL`). They
only affect GET/HEAD navigation on the exact public/app hostnames, preserve deep
links and queries, and use uncached 307 responses so rollback remains possible.
Existing relative Sign in/Get started links enter the app through `/login`.
API endpoints, POST bodies, assets and GitHub popup receipt URLs are not moved
between hosts. This preserves webhook callers and same-origin popup completion.

## Production prerequisites

1. Add `app.closespan.com` to the **existing** Vercel project `feedbackflow-ai`.
   Use the DNS record Vercel supplies for that project; do not replace apex, mail,
   or other existing records. Verify its TLS certificate before directing users there.
2. Register Google's redirect URI:
   `https://app.closespan.com/api/auth/callback/google`.
   Keep the existing public-domain and localhost redirect URIs during transition.
3. Register Slack's redirect URI:
   `https://app.closespan.com/api/integrations/slack/callback`.
4. Register Discord's redirect URI:
   `https://app.closespan.com/api/integrations/discord/callback`.
   Update `DISCORD_OAUTH_REDIRECT_URI` if it is explicitly configured.
5. Coordinate the GitHub App **Setup URL** change to:
   `https://app.closespan.com/api/integrations/github/callback`.
   Do not change its webhook URL just for this migration.
6. Review Pipedream Connect's configured redirect/origin allowlists for the app
   origin. Its existing credential storage and connected accounts stay unchanged.
7. In the production release, set `AUTH_URL=https://app.closespan.com` and
   `CLOSESPAN_APP_DOMAIN_ENABLED=true`. If `NEXT_PUBLIC_APP_URL` is configured,
   align it with the app origin and rebuild. Do not rotate auth/provider secrets.

Auth.js session cookies, workspace-selection cookies, and OAuth state cookies
remain host-only. Users must sign in on the new host; do not share session cookies
using `Domain=.closespan.com`. The existing appearance cookie is non-authentication
state and is unchanged. API same-origin checks and CSP stay intact.

## Preserve operational endpoints

Leave `CLOSESPAN_INTERNAL_BASE_URL`, `RELEASE_VERIFIER_CALLBACK_BASE_URL`,
`DISCORD_GATEWAY_FORWARD_URL`, scheduler `CLOSESPAN_ORIGIN`, and executor URLs
unchanged initially. Existing webhook and job URLs remain valid on the original
host; some clients deliberately reject redirects. Move those integrations only
in a separate coordinated change if needed.

Keep `SITE_URL`, public Turnstile hostname, sitemap/canonicals and email sender
domains unchanged. Requests moderation moves to the app without requiring
Turnstile on that hostname. Update the status worker's application monitoring URL
to the new app `/login` after successful cutover, retaining public/API monitors.

## Release verification

Confirm public pages, existing workspace deep links, Google sign-in, onboarding,
sign-out, admin requests moderation, GitHub popup completion, Slack/Discord OAuth
and Pipedream connection. The app returns `noindex, nofollow`, with a disallow-all
robots response; these are discovery controls, not authorization.

The initial code preparation does not claim DNS/provider setup or a production
deployment. Do not enable the switch until those prerequisites are verified.

## Rollback

Disable `CLOSESPAN_APP_DOMAIN_ENABLED`, restore the previous production `AUTH_URL`
and any changed `NEXT_PUBLIC_APP_URL`, then redeploy. Coordinate restoring the
GitHub Setup URL. Retain both sets of registered OAuth callback URLs while
investigating. Do not delete DNS, secrets or webhook configuration as part of rollback.
