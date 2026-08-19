# Tenki GitHub Actions runner backend

CloseSpan supports two Tenki execution backends:

1. `tenki_sandbox` uses the Tenki Sandbox SDK and disposable Linux microVMs.
2. `tenki_github_actions` dispatches an approval-bound repository workflow to
   Tenki's GitHub Actions runner fabric. This backend covers macOS/Xcode and
   Linux x64 jobs that require nested KVM, including Android Emulator tests.

## Authoritative Tenki references

Keep these product documents with the implementation and re-check them before
changing runner labels, Xcode policy, Android images, or resource assumptions:

- Linux x64 runners: <https://tenki.cloud/docs/runners/x64-runners>
- Runner sizes and exact `runs-on` labels: <https://tenki.cloud/docs/runners/sizes>
- macOS runners: <https://tenki.cloud/docs/runners/macos-runners>
- macOS Xcode and custom images: <https://tenki.cloud/docs/runners/macos-xcode-and-images>
- Android Emulator with nested KVM: <https://tenki.cloud/docs/runners/android-emulator>

These are runner capabilities, not endpoints in the Linux-only Tenki Sandbox
SDK. Runner jobs are dispatched through GitHub Actions.

## Repository workflow contract

Runner-backed repositories must contain this workflow on the approved base
commit:

`/.github/workflows/closespan-agent-runner.yml`

Repositories that use Product Problem runtime verification must also contain:

`/.github/workflows/closespan-runtime-verifier.yml`

Use the reviewed template at
[`templates/tenki-github-actions/closespan-agent-runner.yml`](../templates/tenki-github-actions/closespan-agent-runner.yml).
Copy it without modification so its SHA-256 can be bound into the execution
profile. Customer repositories do not define an `OPENAI_API_KEY` Actions
secret. The implementation job exchanges its GitHub OIDC identity for a
short-lived token scoped to the approval-bound run, then sends Responses API
traffic through CloseSpan. CloseSpan resolves the encrypted workspace OpenAI
credential first and otherwise falls back to its server-side
`OPENAI_API_KEY`; the provider key never enters workflow inputs, artifacts, or
the customer repository.

The detector records the file's SHA-256 in execution-profile version 3. A
profile cannot be activated without that digest. At dispatch, CloseSpan reads
the workflow again at the exact approved commit, verifies the digest, creates a
dedicated `closespan/runs/<run-id>` ref at that commit, and dispatches the
workflow on that immutable ref.

The companion runtime-verifier template lives at
[`templates/tenki-github-actions/closespan-runtime-verifier.yml`](../templates/tenki-github-actions/closespan-runtime-verifier.yml).
CloseSpan hashes it independently for every issue-verification run. It checks
out the exact current commit, exercises the reported user-visible path, and
returns one of `Confirmed current`, `Not reproduced`, or
`Verification blocked`. A clean build, source inspection, or unavailable
runtime can never produce `Not reproduced`. The verifier cannot push, commit,
open a pull request, merge, or deploy.

The workflow must declare `workflow_dispatch` inputs:

- `closespan_run_id`
- `closespan_org_id`
- `closespan_callback_url`
- `closespan_profile_hash`
- `closespan_control_runner_label`
- `closespan_runner_label`

The CloseSpan GitHub App installation must grant repository **Actions:
read/write** permission. GitHub requires Actions write permission for the
workflow-dispatch REST endpoint. Existing Sandbox-only installations do not
need this permission until `TENKI_GITHUB_ACTIONS_ENABLED=true`.

The runner implementation must enforce these properties:

- Checkout is fixed to the dispatched ref and verified against the approved
  base SHA returned by CloseSpan.
- The implementation job and independent verification job run as separate
  jobs, therefore as separate fresh Tenki VMs.
- Bootstrap and callback jobs use the Linux autoscale control label. They never
  replace the execution profile's platform label for implementation or
  verification.
- Repository commands never receive the callback signing secret or model
  credentials in their environment.
- The verification job applies only the bounded changed-file artifact to a
  fresh checkout and runs the immutable profile commands.
- Runner callbacks use a GitHub Actions OIDC identity token with audience
  `closespan-agent-run`; no CloseSpan signing secret enters repository inputs or
  the runner environment. CloseSpan verifies the repository, immutable ref,
  workflow path, workflow-dispatch event and configured GitHub App bot actor.
  The final callback includes the workflow run ID, distinct
  implementation and verification job IDs, actual runner label and platform,
  and a passing independent-verification attestation.
- The runner never pushes, opens a pull request, merges, or deploys. CloseSpan
  can separately merge its exact runner-setup pull request after a workspace
  admin chooses **Approve and merge runner setup** in the app. That path
  revalidates the immutable workflow, rejects extra file changes, requires all
  reported GitHub Actions runs on the exact head commit to pass, records the
  approval, and lets GitHub enforce branch protection. It never writes the
  workflow directly to the default branch. Separately, CloseSpan validates
  implementation reports and publishes draft implementation PRs through its
  GitHub App.

## Platform and runner routing

| Repository evidence | Backend | Required runner capability |
| --- | --- | --- |
| Node, Python, Go, Rust, JVM and similar server/web roots | Tenki Sandbox | Digest-pinned Linux image or snapshot |
| Xcode project/workspace targeting iPhoneOS | Tenki GitHub Actions | macOS Apple Silicon, pinned Xcode, iOS Simulator |
| Android Gradle plugin with instrumented tests | Tenki GitHub Actions | Linux x64, nested KVM, Android Emulator |

Runner selection is inventory-first. CloseSpan discovers the Tenki labels that
are actually enabled for the customer, enriches them with the reviewed
deployment catalog, and applies this order:

1. Match ecosystem and platform (`macos` for iOS, `linux` for Android).
2. Match architecture and toolchain (Xcode major or Android API + nested KVM).
3. Reject offline and undersized candidates.
4. Choose the smallest compatible Tenki capacity.
5. Run the repository-owned compatibility and sizing probe.
6. Activate the profile only after the probe succeeds.

The actual `runs-on` label—not a CloseSpan capacity alias—is stored in the
immutable execution profile. `TENKI_RUNNER_CATALOG_JSON` supplies metadata that
GitHub runner labels do not carry. Entries may be scoped by `orgId` and/or
`repository` and declare `platform`, `architecture`, `cpuCores`, `memoryMb`,
`xcodeMajors`, `androidApiLevels`, and `nestedKvm`.

CloseSpan first reads the repository-visible self-hosted runners, because
organization runner groups can restrict a label to selected repositories. It
consults organization inventory only when repository discovery is unavailable.
That live discovery requires the optional GitHub App organization permission
**Self-hosted runners: read**. Tenki JIT runners are ephemeral and may produce
an empty GitHub runner inventory while idle, so the reviewed, repository-scoped
deployment catalog remains authoritative even when live discovery succeeds.
The legacy
`TENKI_MACOS_RUNNER_LABEL` and `TENKI_ANDROID_RUNNER_LABEL` variables are only
bootstrap overrides for older profiles.

If no compatible Tenki candidate exists and
`GITHUB_HOSTED_RUNNER_FALLBACK_ENABLED=true`, CloseSpan may select a compatible
GitHub-hosted image. This is an explicit fallback: the profile stores
`provider=github_hosted`, `selectionSource=github_hosted_fallback`, and the
reason, and the UI labels it **GitHub-hosted fallback**. Set the variable to
`false` to fail closed instead. A Tenki capacity/profile name is never silently
translated into a GitHub-hosted label.

`TENKI_CONTROL_RUNNER_LABEL` defaults to Tenki's documented small Linux runner
`tenki-standard-small-2c-4g` and is used only for lightweight bootstrap and
authenticated callback jobs. Never route
macOS implementation or verification through this label. Use it for Android
implementation or verification only if Tenki explicitly confirms that the
selected Linux runner exposes nested KVM; otherwise retain the dedicated
Android KVM label.

## Profile activation

Static detection proposes the project/workspace, scheme, simulator destination,
Gradle task and the compatibility-filtered actual runner label. Before
activation, a probe workflow must confirm those values on the selected runner.
The confirmed profile remains bound to
the repository root, workflow SHA-256, source commit, commands and platform
contract. Any workflow or toolchain change creates a new detected version that
requires review.

The reviewed sizing workflow lives at
`.github/workflows/closespan-runner-sizing.yml`. It runs the detected install,
build, typecheck and test path at the exact repository SHA and records duration,
average CPU saturation, peak memory, memory pressure, exit code, signal,
timeout and OOM state. Exit 137, OOM, memory pressure at or above 90%, or CPU
saturation at or above 90% recommends the next size for the same platform. The
selected label, telemetry and reasons are stored with the immutable profile.
At the largest tier, a resource failure remains visible instead of inventing a
larger runner.

Capacity baseline selection uses repository evidence: lightweight Linux validation
starts small, runnable applications start medium, build-heavy work starts
large, Android Emulator work starts large (or large-plus for multi-module
work), and iOS Simulator work starts from the corresponding macOS tier. The
baseline is a sizing requirement, not a substitute `runs-on` label.

## Deployment checklist

1. Install Tenki's GitHub App on the repository and copy the exact enabled
   runner labels from the Tenki Runners page. KVM must be enabled by Tenki for
   Android and custom Xcode images must be provisioned by Tenki.
2. Install all three reviewed templates as
   `.github/workflows/closespan-agent-runner.yml` and
   `.github/workflows/closespan-runtime-verifier.yml`, plus
   `.github/workflows/closespan-runner-sizing.yml`, through the CloseSpan
   runner-setup pull request.
3. Grant the CloseSpan GitHub App Actions and Workflows read/write access and,
   when live inventory discovery is desired, organization Self-hosted runners
   read access. Set `CLOSESPAN_INTERNAL_BASE_URL`, `GITHUB_APP_BOT_LOGIN`,
   `TENKI_RUNNER_CATALOG_JSON`, and
   `TENKI_CONTROL_RUNNER_LABEL=tenki-standard-small-2c-4g`.
4. Set `TENKI_GITHUB_ACTIONS_ENABLED=true`, re-detect the execution profile,
   run its probe, and confirm the new digest-bound profile.

## GitHub App permission boundary

CloseSpan uses the smallest permission set that covers its implemented GitHub
operations:

| Repository permission | Access | Purpose |
| --- | --- | --- |
| Metadata | Read | GitHub-required repository discovery |
| Contents | Read and write | Inspect exact commits and create approval-bound branches/commits |
| Pull requests | Read and write | Create draft PRs and perform separately approved merges |
| Actions | Read and write | Dispatch and observe the reviewed runner workflow |
| Workflows | Read and write | Install the reviewed workflow under `.github/workflows/` |

Optional organization permission:

| Organization permission | Access | Purpose |
| --- | --- | --- |
| Self-hosted runners | Read | Discover the Tenki runner labels currently enabled for the customer |

Keep Administration, Secrets, Variables, Deployments, Environments, Checks,
Commit statuses, Issues, and all unrelated repository permissions at no access
until implemented product code requires a specific endpoint. Tenki's runner App
owns its separate runner-infrastructure permissions; do not duplicate those
permissions onto CloseSpan.
