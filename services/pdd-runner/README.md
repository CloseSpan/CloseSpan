# CloseSpan PDD runner

This service pins `pdd-cli==0.0.309` and uses PDD local/manual test generation.
It downloads a short-lived GitHub archive, writes the signed CloseSpan prompt,
and invokes:

```text
pdd --local --force --quiet --no-core-dump --output-cost pdd-costs.csv \
  test --manual --language <language> --output <test> <prompt> <source>
```

The runner does not receive GitHub credentials and does not execute repository
code. It returns the generated test, SHA-256 hash, approved repository command,
model, and measured cost through an HMAC-signed callback. CloseSpan validates
the paths, command, hashes, prompt identity, and budget again before exposing an
approval.

Every accepted job uses signed payload schema v2. Embedded execution-profile
schemas v1 and v2 are supported and attested by `/health` as
`executionProfileSchemaVersions: [1, 2]`. The runner verifies the immutable
profile ID, canonical configuration hash, repository/root scope, resource and
network policy, and confirms that ticket paths and commands are narrower than
the bound profile. For profile v2 it additionally validates automatic setup,
metadata-only secret bindings, public environment values, application startup,
health checks, previews, and runtime-tool provisioning. Secret values are never
accepted by this service. Legacy job payloads, malformed profiles, and inactive
detected profiles fail closed before any archive is downloaded.

PDD's manual `test` command reports cost but does not currently expose a
pre-spend hard budget flag. For a strict dollar ceiling, route the runner's model
traffic through a provider gateway that enforces a per-request/project budget.
CloseSpan also rejects completed artifacts whose reported cost exceeds
`PDD_MAX_BUDGET_USD`, preventing them from unlocking an agent run.

## Preferred deployment: Tenki

CloseSpan prefers a sticky, network-enabled Tenki session for this runner so
PDD generation consumes the workspace's Tenki credits. Implementation and
independent-verification sessions remain separate and network-disabled.

The sticky VM is not scheduled to expire. Tenki currently reports its session
timeout as effectively unlimited, and it remains active until CloseSpan closes
it explicitly. The date previously recorded in `.tenki/pdd-runner.json` (for
example, September 5, 2026) belongs only to the legacy ephemeral port-exposure
URL; it is not the VM's lifetime or a Tenki-credit expiration date.

Production uses a stable Tenki PreviewUrl named by
`PDD_RUNNER_STABLE_SLUG` (default `closespan-pdd-production`). The application
keeps that stable URL as `PDD_RUNNER_URL`. Rotation changes the PreviewUrl's
session binding rather than changing the application URL, so rotating a runner
does not require a Vercel environment update or redeploy.

Configure `TENKI_API_KEY`, `PDD_RUNNER_SHARED_SECRET`, the CloseSpan callback
origin, and a supported model key in `.env`, then run:

```bash
npm run pdd:deploy:tenki
```

The command provisions the session, installs the pinned PDD CLI, starts this
server, checks its internal health endpoint, and binds the stable PreviewUrl to
port 8080. The sticky runner continues consuming Tenki credits until it is
stopped explicitly. Non-secret deployment state is recorded under the ignored
`.tenki/` directory for operator visibility, but it is not the routing source
of truth.

## Automatic rotation

The `PDD runner rotation` GitHub Actions workflow runs once per day. Its fixed
concurrency group allows only one production rotation at a time. The check is
idempotent: a healthy runner younger than
`PDD_RUNNER_ROTATION_MAX_AGE_DAYS` (default 21 days) is retained. A runner is
replaced when it is unhealthy, no longer running, older than the configured
maximum age, incompatible with the pinned release, or when an operator invokes
the workflow with **force** enabled.

The stable PreviewUrl binding is the routing source of truth. A rotation:

1. creates and configures one candidate sticky session;
2. verifies the candidate's internal and public `/health` responses;
3. rebinds the stable PreviewUrl from the old session to the candidate;
4. verifies both the binding's `sessionId` and `/health` through the stable URL;
5. restores the old binding and closes the candidate if cutover verification
   fails; otherwise
6. drains the old runner for `PDD_RUNNER_DRAIN_MS` (default five minutes) and
   then closes that exact session.

Tenki's current SDK requires an explicit unbind followed by bind; it does not
replace an occupied binding in one call. The workflow concurrency lock prevents
competing writers, rollback restores the captured prior session, and CloseSpan
retries only the route-level 404/502/503/504 responses that can occur during
that short control-plane window. Accepted jobs are never retried.

Cleanup is deliberately narrow: it targets only sessions carrying the
rotation-managed CloseSpan metadata and never treats an ephemeral URL or the
ignored local state file as ownership proof.

The workflow requires these GitHub repository secrets:

- `TENKI_API_KEY`
- `PDD_RUNNER_SHARED_SECRET`
- `OPENAI_API_KEY`
- `CLOSESPAN_CALLBACK_ORIGIN`
- `CLOSESPAN_INTERNAL_BASE_URL`
- `STATUS_PROBE_SECRET`

The callback values must resolve to the production CloseSpan origin and must
not contain credentials. `CLOSESPAN_CALLBACK_ORIGIN` is used by the runner;
`CLOSESPAN_INTERNAL_BASE_URL` is supplied as the existing application-side
fallback. Secret values are injected only into the Actions process and the
candidate runner; they must not be committed or printed.

To make the next daily check rotate immediately, use the workflow's **Run
workflow** control and enable **force**. The same check can be run locally with:

```bash
PDD_RUNNER_FORCE_ROTATION=true npm run pdd:runner:rotate
```

Required environment:

- `TENKI_API_KEY`
- `PDD_RUNNER_SHARED_SECRET`
- `CLOSESPAN_CALLBACK_ORIGIN` (for example `https://www.closespan.com`)
- one PDD-supported local model credential, such as `OPENAI_API_KEY`
- optional `PDD_RUNNER_STABLE_SLUG` (default `closespan-pdd-production`)
- optional `PDD_RUNNER_ROTATION_MAX_AGE_DAYS` (default `21`)
- optional `PDD_RUNNER_DRAIN_MS` (default `300000`)
- optional `PDD_RUNNER_FORCE_ROTATION` (`true` or `1` forces replacement)
- optional `PDD_MODEL`
- optional `PDD_RUNNER_CONCURRENCY` (default `2`)
