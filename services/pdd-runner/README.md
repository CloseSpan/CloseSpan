# CloseSpan PDD runner

This service pins `pdd-cli==0.0.306` and uses PDD local/manual test generation.
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

Every accepted job uses signed payload schema v2. The runner verifies the
immutable execution-profile ID, canonical configuration hash, repository/root
scope, resource and network policy, and confirms that ticket paths and commands
are narrower than the bound profile. Legacy or inactive detected profiles fail
closed before any archive is downloaded.

PDD's manual `test` command reports cost but does not currently expose a
pre-spend hard budget flag. For a strict dollar ceiling, route the runner's model
traffic through a provider gateway that enforces a per-request/project budget.
CloseSpan also rejects completed artifacts whose reported cost exceeds
`PDD_MAX_BUDGET_USD`, preventing them from unlocking an agent run.

## Preferred deployment: Tenki

CloseSpan prefers a sticky, network-enabled Tenki session for this runner so
PDD generation consumes the workspace's Tenki credits. Implementation and
independent-verification sessions remain separate and network-disabled.

Configure `TENKI_API_KEY`, `PDD_RUNNER_SHARED_SECRET`, the CloseSpan callback
origin, and a supported model key in `.env`, then run:

```bash
npm run pdd:deploy:tenki
```

The command provisions the session, installs the pinned PDD CLI, starts this
server, checks its internal health endpoint, exposes port 8080 through a
seven-day URL, and prints the URL to configure as `PDD_RUNNER_URL`. The public
URL expires automatically and must be renewed or redeployed. The sticky runner
continues consuming Tenki credits until it is stopped explicitly with
`npm run pdd:stop:tenki`. Non-secret deployment state is recorded under the
ignored `.tenki/` directory.

Required environment:

- `PDD_RUNNER_SHARED_SECRET`
- `CLOSESPAN_CALLBACK_ORIGIN` (for example `https://www.closespan.com`)
- one PDD-supported local model credential, such as `OPENAI_API_KEY`
- optional `PDD_MODEL`
- optional `PDD_RUNNER_CONCURRENCY` (default `2`)
