# Product

<!-- impeccable:product-schema 1 -->

## Current discovery direction — September 18, 2026

The owner requested a customer-success-focused MVP investigation before further feature work: uploaded post-call summaries, reviewable extracted concerns, and clear issue-to-feature relationships grounded in approved product/GitHub context. This is a proposed direction, not a built or market-validated capability. See `docs/customer-success-mvp-research.md` for the competitive evidence and two-view scope under consideration.

The current localhost UI is deliberately reset through the reversible, development-only `CLOSESPAN_UI_RESET` flag. The previous screens and backend remain preserved; no execution or approval policy changed. The sections below describe that existing implementation, not the proposed MVP's everyday navigation.

## Platform

web

## Users

CloseSpan serves a shared cross-functional team inside a B2B SaaS company. Product management, product operations, support, customer success, and engineering collaborate in the same workflow, with each discipline contributing evidence or decisions rather than operating from separate interpretations of the customer problem.

## Product Purpose

CloseSpan turns reports in Slack or Discord into tracked issues, agent implementations, reviewed pull requests, and tested fixes. People contribute domain knowledge and review outcomes; they do not operate the internal prompt, investigation, or runner pipeline. CloseSpan issues are the primary record. Linear is optional rather than a prerequisite.

Success means a domain expert can understand what was reported, what should happen, what changed, and what needs a decision. Detailed evidence remains available without filling the everyday interface.

## Positioning

CloseSpan is an accountable feedback-to-fix operating system, not a feedback analytics dashboard or autonomous coding tool. Its distinctive mechanism is one inspectable evidence chain combined with human-governed agent execution: recommendations remain testable hypotheses, acceptance criteria remain user-owned, and consequential external actions remain reviewable.

## Operating Context

The lifecycle is Report → Track → Implement → Review → Improve → Validate → Human merge. Reporting starts in approved sources. Investigation, prompt generation, protected acceptance tests, implementation, and trusted PR-review corrections run in the background within workspace policy. The interface shows actual current evidence, not a checklist of internal operations or a claim that incomplete automation has succeeded.

The opt-in **Automatic coding, human merge** policy allows eligible new work in approved repositories. Complete, passing requirements can receive exact-prompt policy acceptance, recorded separately from human confirmation. Missing or ambiguous requirements still need attention. Existing manual policies remain supported. Every merge or deployment requires a current authorized human decision bound to the reviewed change, including on legacy Full autonomy workspaces. Saving this mode is a separate administrator action; a UI redesign does not enable it.

Daily navigation is **Issues / Needs your review / Settings**. Issues has searchable list and board views; each issue has expected behavior, real results, checks, risks, and contextual actions. Needs your review combines domain questions and execution decisions, with history explicitly separate. Original reports, technical diagnostics, prompts, provider controls, and run history remain on secondary routes. Old Overview and Prompt Testing list URLs lead to Issues.

## Capabilities and Constraints

- Recommendations must be grounded in customer evidence. Only unresolved gaps, risks, and actionable results belong in the default view; original evidence is one link away.
- English requirements remain domain-readable acceptance contracts. Internal prompt text and technical preparation controls are secondary, not user-operated steps.
- Acceptance tests are protected from being weakened by the implementation agent.
- Code execution and testing occur in an isolated Tenki environment before repository or deployment actions proceed.
- Administrator policy governs automatic coding; human decisions always gate merge and deployment. Confirming expected behavior is not proof of a live application test.
- Automatic admission checks recorded model usage against configured limits. Missing provider charges or in-flight costs mean this is not a guaranteed billing cap.
- Persistent issue conversation is separate from execution authorization. Scenario checks evaluate the expected requirement, not the running application. Saved current runtime evidence is the only basis for a reproduction claim.
- Domain experts can record “This works” or “Needs changes” against the exact implementation commit. Requested changes block the final action on that result. A separate administrator decision can authorize one follow-up run on the existing PR, preserving the original acceptance contract. This human-feedback path is separate from trusted Tenki PR-review remediation.
- These capabilities require their database migrations; human-feedback rework additionally requires a compatible executor rollout and an explicit enable flag. A local UI build does not deploy these dependencies or change workspace policy.
- Agent progress, failures, review feedback, revisions, and final outcomes must remain visible and recoverable.
- Customer data and credentials remain tenant-scoped; integrations use approved least-privilege access and explicit simulation boundaries where a connector is not live.
- The existing product is implemented with Next.js, React, TypeScript, PostgreSQL, Prompt Testing, and Tenki-backed execution.

## Brand Commitments

The product name is CloseSpan. The user-selected reference is Attio: crisp neutral surfaces, fine borders, Geist typography, compact controls, a flat CloseSpan `</>` wordmark, and clear human-control states. Light and neutral are the defaults. Personal Appearance settings offer Light, Dark, System, and eight accent choices, saved automatically in the current browser; these do not alter workspace policy or status colors. Workspace navigation stays expanded and task labels stay concise. Avoid the previous purple default branding and raised neumorphic styling; optional personal accents do not change that structural language. The visual language should communicate confidence and traceability without making agentic actions feel magical, opaque, or autonomous.

## Evidence on Hand

- The repository implements authenticated feedback, problem, investigation, approval, engineering-ticket, Prompt Testing, Tenki, notification, integration, release, and follow-up workflows.
- `README.md` documents the feedback-to-fix operating model and the protected Prompt Testing/Tenki acceptance workflow.
- Current Issues, review inbox, issue detail, and settings components implement the issue-centered information architecture. The persisted Impeccable records document the incumbent Attio visual system.
- No customer testimonials, production performance benchmarks, or outcome claims should be invented without separate verified evidence.

## Product Principles

1. Preserve one inspectable chain from customer evidence to deployed outcome.
2. Let agents propose, test, implement, and revise; let humans own intent and consequential approvals.
3. Surface uncertainty as an actionable question or failed check; keep confidence calculations and pipeline details out of routine screens.
4. Prefer the next accountable action over passive reporting or vanity analytics.
5. Make every automated step observable, reversible where possible, and recoverable when it fails.

## Accessibility & Inclusion

The workflow must remain operable with keyboard and assistive technology, preserve meaningful state feedback under reduced-motion preferences, and expose charts, progress, confidence, evidence, and approval state through programmatic semantics rather than visual styling alone.
