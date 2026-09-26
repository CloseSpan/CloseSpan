# Pylon research and CloseSpan UX decisions

Research date: September 17, 2026. Scope: official product pages, help documentation, and the public interactive walkthrough. This is competitive/product research, not customer interviews or an authenticated Pylon implementation test. Capability descriptions below are vendor claims unless identified as observed. No Pylon account, paid service, or connector was provisioned.

## Recommendation

Make **the issue the place where the work happens**, and make **the next human decision** the most obvious thing on screen. Preserve CloseSpan's current neutral visual system and expanded navigation. Do not copy Pylon's entire support suite or introduce another agent dashboard.

CloseSpan's proposed promise is: **Report the problem. Agree on the outcome. Review the tested fix. Approve the merge.** Investigation, prompt maintenance, review remediation, and runner configuration should support this journey, not become mandatory pages users operate.

## What Pylon actually offers

### 1. A shared customer-work record

Pylon's ticketing product brings conversations from multiple channels into an issue, retaining participants and customer context. It offers inbox, list, and board views, routing, saved filters, and incident grouping. Its scope includes support operations beyond engineering fixes. This supports using familiar queues and a stable issue record in CloseSpan—not adding another dashboard for each backend subsystem. [Ticketing](https://www.usepylon.com/ticketing)

Pylon's orientation describes issues, accounts, and contacts, plus knowledge, analytics, product intelligence, and administration. Product intelligence groups feedback into themes with supporting issue/account context. Semantic clustering alone is therefore not a distinctive CloseSpan pitch. For our MVP, accounts and analytics should remain supporting context, not equally prominent destinations. [Platform orientation](https://support.usepylon.com/articles/4220063775-platform-orientation-pylon-101)

### 2. Investigation beside the conversation

Assist is a contextual agent available within an issue or account. Pylon says it can investigate across support history, CRM, Linear, logs, and code, return evidence, and propose actions. Its permission model follows the person using it and team approval rules. The page's broad “asks before it acts” language should not be interpreted as a guarantee that every configured action always requires confirmation; its FAQ also describes configurable automatic actions. [Assist Agent](https://www.usepylon.com/ai-agents/assist)

Its multitasking guide recommends keeping Assist in the initial issue view, receiving prepared findings, asking follow-up questions, and distinguishing agents that are working from work waiting on a person. This is the most relevant UX lesson: users should not navigate through preparation screens just to understand the next question. [Working on multiple issues](https://support.usepylon.com/articles/4437814923-how-to-work-on-multiple-issues-in-parallel)

### 3. Background work with reusable procedures

Background Agents respond to events or schedules, investigate connected systems, and put findings back into the issue. Skills describe repeatable checks, decisions, tools, and approval steps. These are configuration concepts, not necessarily daily navigation. CloseSpan's PDD and test rules belong behind the issue experience in the same way. [Background Agents](https://www.usepylon.com/ai-agents/background), [Skills](https://www.usepylon.com/ai-agents/skills)

Pylon distinguishes its internal Slack Agent from customer-message intake through Slack Connect. The internal agent lets teammates request investigations and permitted actions from Slack. CloseSpan should likewise distinguish receiving a report from authorizing code execution; a customer message must not silently become a merge authorization. [Slack Agent](https://www.usepylon.com/ai-agents/slack)

### 4. Engineering integration and real competitive overlap

Linear integration links support issues to engineering work, synchronizes comments, and returns completed engineering work to a human follow-up state. CloseSpan can keep Linear optional while adopting the same principle: an engineering status change is not automatically proof that the customer's problem is resolved. [Linear integration](https://www.usepylon.com/integrations/linear)

Pylon is **not merely an inbox that stops at escalation**. Its MCP offering explicitly describes giving Claude Code issue context and opening a fix PR. Separately, its Cursor integration invokes a coding agent from a Pylon issue; the setup guide warns that cloud agents may create PRs unless disabled in Cursor settings. These are meaningful overlaps with CloseSpan. [MCP integration](https://www.usepylon.com/integrations/mcp), [Cursor setup](https://support.usepylon.com/articles/3581860641-how-to-install-cursor-integration)

The two integration directions matter: external coding tools can access Pylon through OAuth MCP, while Pylon can invoke Cursor using a configured API key and repository. Do not imply that exposing an MCP endpoint itself supplies a complete independent test-and-release pipeline.

From the pages reviewed, we did not establish a Pylon-owned, end-to-end contract covering reproduction, implementation, independent diff review, protected acceptance tests, isolated validation, and exact-change human release approval. That is an **unverified comparison point**, not proof of an absent capability. CloseSpan must demonstrate this chain with working evidence before using it as a differentiator.

### 5. Access, security, and cost

Pylon's MCP help describes OAuth access for eligible Member/Admin users, rather than API-key machine-to-machine MCP authentication. Custom MCP connectors and API tools bring additional systems into agents; such access requires deliberate permission boundaries. [MCP help](https://support.usepylon.com/articles/2407390554-connecting-to-the-pylon-mcp-server), [Custom MCP connectors](https://support.usepylon.com/articles/3815553804-how-to-connect-a-custom-mcp?lang=en)

Pylon publicly lists security/compliance certifications, but this research did not inspect audit reports or independently validate controls. Its current pricing path led to a sales-demo page, so a current base subscription price was not verified. Obtain a quote covering seats, agents, usage, and external coding-tool charges before making a cost comparison. [Security](https://www.usepylon.com/security), [Sales/demo](https://www.usepylon.com/schedule-demo)

## What the public UI demonstrates

Observed in the Agentic Support walkthrough: an issue list, a customer conversation, and an adjacent agent panel with investigation findings and evidence. The useful design mechanism is continuity of context. The desktop demonstration itself is dense and aimed at support operators; reproducing its three-pane density would conflict with CloseSpan's domain-expert audience and minimal-UI brief. This was a staged public tour, not proof of production performance or customer usability. [Interactive demos](https://www.usepylon.com/interactive-demos)

## Applied to CloseSpan

| User question | Interface response | Boundary |
| --- | --- | --- |
| What needs me? | Needs attention queue and attention-first All list | A legacy intake label alone is not a pending decision. |
| What is happening? | In progress queue with the existing recorded status | Never infer a live run from historical activity. |
| What do I do next? | A short contextual navigation label on each issue | Opening an issue does not start work or approve anything. |
| Where can I discuss this? | Direct access to the existing issue conversation | Chat and scenario checks are not execution authorization. |
| Is the expected behavior right? | Confirm or Needs changes; show the feedback field only when requested | Confirmation is not a live app test or coding approval. |
| Can this be merged? | Review the current result, risks, and explicit final approval | Missing live tests remain visible; human merge stays separate. |

The implementation keeps list/board choice, search, severity, source reports, diagnostics, accessibility, and light/dark theme support. It does not add accordions, hide the desktop sidebar, provision integrations, enable automatic coding, run sandboxes, apply database migrations, or deploy anything.

The Issues attention filter uses the existing issue review/status projection; it is not a complete personal approval inbox. **Needs your review** remains the authoritative destination for pending execution decisions. Precise coding/merge actions on list rows would require additional current approval data; this pass deliberately uses navigation labels rather than guessing those permissions.

## What to leave out of the MVP

- Separate dashboards for investigation, prompt readiness, agent execution, and validation.
- Confidence formulas, raw prompt hashes, runner IDs, capability lists, and routine audit narration in the default issue view.
- Enterprise support features such as workforce scheduling, broad CRM management, surveys, and complex queue builders.
- Claims that a requirement/scenario check reproduced the problem in a live application.
- Claims of differentiation based only on “AI agents”, clustering, or opening PRs.

## How to validate this with real users

Use support, product/domain, and engineering participants—not only the builder. Give each person the same representative issue and ask them to find what needs attention, explain the expected behavior, locate the evidence, request a correction, and identify who can authorize coding and merging. Record wrong turns, time to the next action, and any confusion between scenario checks and live tests. These are proposed research tasks, not results we have already collected.

The central test: can a domain expert explain **what is wrong, what should happen, what was checked, and what decision is theirs** without learning the internal agent pipeline?

## Implementation verification

- 78 focused component/lifecycle tests passed; scoped ESLint and TypeScript checks passed.
- Browser checks covered the existing demo workspace at desktop and 390px mobile: attention ordering, queue counts, search intersection, no-result recovery, list/board switching, closed-state filtering, keyboard focus, and issue-section jumps. No horizontal page overflow was observed.
- An independent read-only code review found no actionable new approval or state-handling issues.
- The design detector reported advisory typography mismatches for incumbent 12px metadata and the documented 25px mobile heading; these established sizes were retained rather than changing the visual system to satisfy the detector.
- The local web server was restarted after a stalled compile. The scheduler was not started. The browser also reported an unrelated storage I/O warning, and the server emitted its existing PostgreSQL SSL-mode deprecation warning; neither was changed in this UI pass.
- These checks do not establish real customer usability or end-to-end production execution. The presentation workspace remains read-only; live actions and pending backend setup were not exercised or enabled.
