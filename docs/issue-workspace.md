# CloseSpan MVP: one issue workspace

## Product decision

The user operates as a domain expert, not a pipeline administrator. The main product is a continuous issue workspace: understand the problem, clarify the outcome with CloseSpan, approve work, try the result, and separately authorize a merge. Linear synchronization remains optional and outside this build.

## Phased delivery

| Phase | Product result | Verification |
| --- | --- | --- |
| 1 — Context | Short issue subjects, linked report counts, current verification evidence and expected outcomes | Tenant-scoped reads; stale repository/commit evidence is not presented as current |
| 2 — Discussion | Persistent issue conversation and an explicit scenario check | Saved server-owned history, bounded context, policy checks and replay-safe model requests |
| 3 — Result feedback | “This works” or “Needs changes” against the exact implementation result | Human review is commit-bound and cannot be confused with a test pass or a merge |
| 4 — Follow-up | Separate administrator authorization for one correction run on the existing PR | Original acceptance contract retained; changed heads, stale reviews and duplicate requests rejected |
| 5 — Local verification | Desktop/mobile journey and regression checks | Presentation fixtures remain read-only; no paid service or production action is triggered by QA |

## Information architecture

- **Issues:** concise subject, report count, stage and priority. Opening a row opens the same issue workspace throughout its lifecycle.
- **Needs your review:** a shortcut to decisions, not a second investigation interface.
- **Settings:** integrations, personal appearance and administrator policy. Technical evidence and diagnostics remain secondary routes.

The desktop issue workspace places the brief, expected outcomes and result on the left, with the persistent conversation beside them. Mobile uses the same content in a single column. No new collapsible sections, charts, global chat or pipeline controls are introduced.

## Approval and evidence contract

| User action | Meaning | Does not mean |
| --- | --- | --- |
| Discuss | Ask about saved issue context or propose a requirement update | Start coding, run a sandbox, or merge |
| Check scenario | Evaluate whether the requirement covers a described outcome | Reproduce a bug in the running application |
| Confirm | Accept the stated expected behavior | Authorize a coding run |
| Review coding run | Review a separately bound execution approval | Approve a merge or deployment |
| This works | Record the human's assessment of the exact recorded result | Claim tests passed, or merge |
| Needs changes | Record outcome feedback and block final action on that result | Start unapproved rework |
| Approve follow-up run | Authorize one scoped correction of the current PR | Change the original acceptance contract or auto-merge |
| Review merge | Make the separate final, exact-commit decision | Claim deployment succeeded |

Verification copy must come from recorded evidence. Unverified, blocked and outdated results stay explicit. The demo uses clearly labeled sample data and disabled mutations, never fabricated live execution.

## Research basis

The design uses [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) to keep specialist evidence out of the primary task while retaining access to it. Status and errors follow [WAI alert guidance](https://www.w3.org/WAI/ARIA/apg/patterns/alert/): meaningful, non-focus-stealing feedback rather than transient or constantly interrupting notices. The established CloseSpan visual system is retained.

## Deployment boundary

Conversation and result review require their additive database migrations. Follow-up execution also requires the compatible executor code and run-kind migration. Local UI availability does not imply these services were deployed. Testing this build must not launch paid model requests, Tenki sessions, GitHub PR mutations, merges or deployments without explicit authorization.

Migration order: `079_issue_conversations.sql`, `080_issue_result_reviews.sql`, `081_issue_result_rework.sql`, then `082_issue_scenario_checks.sql`. Migration 081 extends the allowed run-kind constraint; it does not rewrite existing runs. Enable `CLOSESPAN_DOMAIN_RESULT_REWORK_ENABLED=true` only after the application and executor both understand the new run kind. The default is off.

Live discussion/scenario calls are disabled while `APP_MODE=demo`, in test mode, and in presentation workspaces. Persistent live workspaces also need a configured provider, preparation-enabled policy and available recorded budget with its hard stop enabled. The UI exposes a read-only state rather than suggesting those calls are available in demo mode.

Discussion and scenario-check retries reuse a durable request instead of silently repeating a paid call. Scenario checks reserve a bounded amount against the workspace's recorded monthly budget; an ambiguous provider failure retains its reservation. This is not a guaranteed cap on the provider's bill or unrelated model workflows.

Current recovery limit: a failed human-feedback follow-up is visible as a failed run, but it cannot use the generic implementation retry because that could discard the feedback binding or open a different PR. A dedicated authorization for retrying that failed follow-up is not part of this build.

## Local verification — September 15, 2026

- Regression suite: 1,977 tests passed, with two existing skipped tests. On the final full run, one localhost socket test encountered a sandbox bind restriction; its two-test file passed when rerun with localhost bind permission.
- Application and executor TypeScript checks passed. Scoped ESLint and whitespace checks passed. Full-repository lint remains blocked by five pre-existing warnings in unrelated `tmp/` scripts.
- Desktop and mobile issue views were inspected in the browser. The final review confirmed the mobile title layout and 44px conversation touch-target fixes.
- The presentation workspace remains read-only. Its sample conversation and results are labeled; no live model, Tenki, PR, merge or deployment operation was used for this verification.
- Migrations 079–082 remain unapplied pending permission for the remote database used by localhost. Follow-up execution remains disabled pending a compatible application/executor rollout. Live end-to-end behavior has not been verified.

For the local walkthrough, open `/problems` in **CloseSpan Demo**, then compare an issue awaiting confirmation with the Salesforce import issue at `/problems/prob_demo_import`. Check the short brief, expected outcomes, sample discussion, current result and distinct review actions. Demonstration controls are intentionally disabled rather than mutating real work.
