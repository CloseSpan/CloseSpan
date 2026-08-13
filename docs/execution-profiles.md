# Workspace execution profiles

CloseSpan resolves every live coding run against a tenant-owned, immutable
execution profile. No global Tenki image, snapshot, repository, or runtime
policy is used for new jobs.

## Lifecycle

1. A workspace explicitly selects repositories exposed by its GitHub App
   installation. The same GitHub installation may be connected to multiple
   CloseSpan workspaces, but repository selection remains independent per
   workspace.
2. CloseSpan reads the default branch ref, commit tree, and a bounded set of
   manifest blobs through the GitHub API. Detection never clones the repository
   and never executes repository code.
3. Each repository or monorepo root produces an inactive `detected` profile.
   GitHub Actions runner profiles remain inactive while a bounded onboarding
   probe measures the selected baseline size. CloseSpan stores the telemetry,
   applies a same-platform next-tier recommendation for resource pressure, and
   creates the immutable active profile. An administrator can save a documented
   runner-size override as another immutable version.
4. Problem evidence is ranked against only the workspace's active authorized
   repositories. Exact and unambiguous matches can advance automatically;
   ambiguous matches wait for product-manager review.
5. At PDD creation CloseSpan resolves the profile in this order:
   ticket override, exact repository/root, repository root, workspace default,
   then the fail-closed safe generic profile.
6. The profile ID, version, SHA-256 hash, and complete snapshot are copied into
   the PDD verification, approval request, implementation run, and independent
   verification context. Each boundary re-hashes the configuration and rejects
   drift. An unconfirmed detected profile cannot start PDD or a Tenki VM.

## Profile contents

A version records language, framework, package manager, runtime, working
directory, permitted path ceiling, exact install/build/test/typecheck command
allowlists, executor backend, CPU, memory, network policy, maximum duration,
and idle timeout. Sandbox profiles bind a Tenki image or snapshot. Runner
profiles bind the repository workflow SHA-256, Tenki runner label and platform
contract, including Xcode/Simulator or Android Emulator settings. A ticket may
narrow paths and commands but cannot widen its selected profile.

See [Tenki GitHub Actions runner backend](./tenki-github-actions-runners.md) for
the retained Tenki x64, macOS/Xcode and Android Emulator references and the
immutable workflow-dispatch contract.

The executor currently keeps implementation and verification inside the hosted
request ceilings (four and three minutes respectively), even when a stored
profile allows a longer Tenki session. Longer asynchronous agent runs require a
separate durable orchestrator that owns agent state outside the Vercel request;
the UI must not present a longer value as effective until that migration is
complete.

## Production rollout

Deploy these changes as one compatibility boundary:

1. Apply migrations through `061_tenki_runner_sizing_probes.sql`.
2. Deploy the PDD runner that accepts signed payload schema version 2.
3. Deploy the Next.js app and the Tenki proxy Worker together.
4. Reconnect or synchronize each GitHub installation, explicitly select the
   repositories for each workspace, run detection, and confirm the intended
   profiles.
5. Run a disposable-repository canary and verify two distinct Tenki session
   IDs, immutable profile hashes, passing PDD tests, and a draft pull request.

Do not enable a detected profile automatically, reuse a profile across
organizations, or publish a PR when independent verification cannot recreate
the profile-bound environment.
