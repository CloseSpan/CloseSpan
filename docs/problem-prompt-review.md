# Background problem review

`/problems/[problemId]` and `/pdd/[problemId]` now show the same domain-review
surface: expected behavior, prompt-test state, and Confirm / Needs changes.
The former investigation page is retained at `/admin/problems/[problemId]`,
with a server-side administrator check and a bounded recovery action.

## Scheduling and prerequisites

Apply `078_problem_prompt_reviews.sql` before deploying the worker. The existing
authenticated internal workflow scheduler invokes `runProblemPromptReviewTick`
once per organization per tick. No work is started by rendering or refreshing a
page. `npm run dev:app` runs only the UI; it does **not** enable the scheduler.
`npm run dev` enables the existing broader scheduler when `CRON_SECRET` is set,
including other configured automation. Do not enable it merely to preview UI.

The worker respects Observe mode and existing repository authorizations,
execution-profile bindings, prompt-preparation policy, model budgets, and
executor isolation. It does not grant repository access or activate profiles.
Missing prerequisites become an administrator-visible blocker.

## Lifecycle

1. Discover eligible open problems and persist a preparation record.
2. Prepare investigation and verify the reported behavior using the existing
   repository-bound verifier, then generate the implementation prompt.
3. CloseSpan evaluates the prompt against the expected behavior. It may apply
   an immutable PDD revision and evaluate again, with at most three evaluations
   per cycle. Each evaluation and transition is retained in the audit trail.
4. A passing prompt is presented for domain confirmation. This is prompt
   alignment, **not** proof that the implementation or a live application passed.
5. Needs changes supplies an amended scenario and queues another bounded cycle.
6. Confirmation is bound to the review version and exact prompt hash. It queues
   acceptance-test preparation, not an implementation approval or deployment.
7. Existing execution and final-action policy still applies. Full-autonomy
   processing cannot bypass an outstanding domain review on enrolled problems.

Claims use row locks and leases so concurrent schedulers cannot own the same
step. Expired leases are blocked rather than automatically replayed. Model
results from expired claims are ignored. Stale confirmations are rejected, and
replaced prompts need another evaluation. Failed acceptance generation is not
repeated on every poll. Only an administrator can explicitly recover blocked
work; recovery is itself audited and cannot bypass a pending execution approval.

Seeded memory workspaces remain explicitly simulated and do not run live work.
