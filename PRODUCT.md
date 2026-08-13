# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

CloseSpan serves a shared cross-functional team inside a B2B SaaS company. Product management, product operations, support, customer success, and engineering collaborate in the same workflow, with each discipline contributing evidence or decisions rather than operating from separate interpretations of the customer problem.

## Product Purpose

CloseSpan owns the complete path from fragmented customer feedback and reported problems to a verified, deployed solution. It groups related evidence into durable problems, measures impact, prepares agentic solution recommendations, lets users define and run acceptance tests through English user stories, improves recommendations from those test results, and keeps code-writing, repository changes, review, and deployment behind explicit human approval.

Success means the team can trace a customer-reported problem through evidence, prioritization, proposed solution, acceptance criteria, sandbox verification, code review, deployment, release verification, and customer follow-up without losing the reasoning or accountability between stages.

## Positioning

CloseSpan is an accountable feedback-to-fix operating system, not a feedback analytics dashboard or autonomous coding tool. Its distinctive mechanism is one inspectable evidence chain combined with human-governed agent execution: recommendations remain testable hypotheses, acceptance criteria remain user-owned, and consequential external actions remain reviewable.

## Operating Context

The workflow begins with feedback imported from approved customer and team sources. CloseSpan normalizes and clusters signals into product problems, connects affected accounts and revenue impact, and prepares agent investigations and proposed solutions. A product user expresses the expected outcome as an English user story; Prompt Testing turns that story into a repository-native acceptance test. Agents use the results to improve the proposed solution.

After user approval, an agent writes code and runs the implementation against protected acceptance criteria in a Tenki virtual machine. The workflow includes automated tests, repository changes, pull-request review in Tenki, revisions in response to review, deployment, release verification, and closing the loop with affected customer conversations.

## Capabilities and Constraints

- Recommendations and suggested solutions must be backed by visible customer evidence, impact, confidence, and unresolved gaps.
- English user stories are product-manager-facing acceptance contracts, not hidden implementation prompts.
- Acceptance tests are protected from being weakened by the implementation agent.
- Code execution and testing occur in an isolated Tenki environment before repository or deployment actions proceed.
- Human approval gates consequential actions, including implementation scope, repository changes, and deployment.
- Agent progress, failures, review feedback, revisions, and final outcomes must remain visible and recoverable.
- Customer data and credentials remain tenant-scoped; integrations use approved least-privilege access and explicit simulation boundaries where a connector is not live.
- The existing product is implemented with Next.js, React, TypeScript, PostgreSQL, Prompt Testing, and Tenki-backed execution.

## Brand Commitments

The product name is CloseSpan. The incumbent identity is a calm, accountable neomorphic interface built around cool blue-gray surfaces, restrained violet accents, soft physical depth, the CloseSpan `</>` mark, and clear human-control states. The visual language should communicate confidence and traceability without making agentic actions feel magical, opaque, or autonomous.

## Evidence on Hand

- The repository implements authenticated feedback, problem, investigation, approval, engineering-ticket, Prompt Testing, Tenki, notification, integration, release, and follow-up workflows.
- `README.md` documents the feedback-to-fix operating model and the protected Prompt Testing/Tenki acceptance workflow.
- The current Overview implementation and persisted Impeccable critique provide evidence of the incumbent visual system and current information architecture.
- No customer testimonials, production performance benchmarks, or outcome claims should be invented without separate verified evidence.

## Product Principles

1. Preserve one inspectable chain from customer evidence to deployed outcome.
2. Let agents propose, test, implement, and revise; let humans own intent and consequential approvals.
3. Turn uncertainty into visible confidence, evidence gaps, and testable acceptance criteria.
4. Prefer the next accountable action over passive reporting or vanity analytics.
5. Make every automated step observable, reversible where possible, and recoverable when it fails.

## Accessibility & Inclusion

The workflow must remain operable with keyboard and assistive technology, preserve meaningful state feedback under reduced-motion preferences, and expose charts, progress, confidence, evidence, and approval state through programmatic semantics rather than visual styling alone.
