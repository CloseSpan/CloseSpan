# CloseSpan customer-success UX research

Research date: September 18, 2026.

Status: proposed direction for discussion. This is desk research and a local implementation review, not a usability-tested design, an approved build specification, or a claim of product-market fit. No application changes accompany this report.

## Recommendation

Make CloseSpan a **customer-issue review and verification workspace**, not a visible agent-operations console.

The everyday experience should answer four questions: What did the customer report? Which part of the product is involved? What did the investigation establish? What can I test or do next?

Use two primary destinations: **Issues** and **Components**. Calls are the input and supporting evidence; the issue is the ongoing unit of work. This updates the Calls/Features navigation proposed in the earlier [market research](customer-success-mvp-research.md), following the PM feedback about investigation and testing. It does not invalidate the earlier competitive assessment.

Keep the current Attio-inspired CloseSpan theme. Simplify information architecture and interactions, rather than introducing another visual redesign.

## 1. What the research establishes

Sources below are official product documentation and published usability/accessibility guidance. Competitor observations are documentation-based, not authenticated hands-on testing. Their patterns provide useful precedents; they do not establish that our proposed workflow is easier, commercially differentiated, or appropriate for every CS team.

“Industry standard” has three different meanings here:

- **Familiar product conventions:** lists, search, filters, records, visible actions, and stable navigation.
- **Usability guidance:** understandable language, system feedback, recognition, and recovery. These are heuristics, not certification. [Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/)
- **Testable accessibility requirements:** target WCAG 2.2 AA. A short checklist alone cannot establish conformance. [W3C recommendation](https://www.w3.org/TR/WCAG22/)

### Evidence and application

| Product / source | Documented pattern | What CloseSpan should borrow | What not to copy into the MVP |
| --- | --- | --- | --- |
| [Attio tables](https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views) and [records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records) | Table columns expose selected attributes; a record opens its associated information and activity. | A short issue row and one consistent detail destination. | A configurable CRM, extensive record tabs, or layout builders. |
| [Linear Triage](https://linear.app/docs/triage) and [filters](https://linear.app/docs/filters) | Incoming work has explicit decisions; filtered views can be shared through URLs. | A meaningful “Needs you” filter, clear next actions, and preserved queue context. | A separate screen for every internal processing stage or advanced query builder. |
| [Linear Customer Requests](https://linear.app/docs/customer-requests) | Customer quotations, source links, identity, and timestamps remain attached to work. | Short summaries with traceable source evidence. | Repeating transcripts or account metadata in every row. |
| [Pylon issue views](https://docs.usepylon.com/pylon-docs/support-workflows/issues/views) and [Copilot](https://docs.usepylon.com/pylon-docs/support-workflows/issues/copilot) | Configurable issue lists coexist with contextual AI answers and summaries. | Issue-first navigation; “Ask CloseSpan” in context. | A blank chat screen as the only way to operate the product. |
| [Pylon feature requests](https://docs.usepylon.com/pylon-docs/product-intelligence/feature-requests) | Related accounts, evidence, and product tickets are available from a request; evidence leads to the original conversation. | One issue can collect multiple reports without losing their origins. | A second duplicate inbox containing the same work. |
| [Productboard insights](https://support.productboard.com/hc/en-us/articles/10071375851155-Support-your-feature-ideas-with-customer-insights) and [automatic linking](https://support.productboard.com/hc/en-us/articles/26949590820627-Link-insights-automatically-with-Productboard-AI) | Customer feedback links to product items; AI-proposed associations can be reviewed. | Correctable component relationships and an honest distinction between suggested and confirmed. | Roadmap planning, scoring frameworks, or a relationship graph as the default view. |
| [Productboard citations](https://support.productboard.com/hc/en-us/articles/34627982878483-Generate-insight-reports-with-Productboard-Pulse) | Generated findings link back to supporting notes. | Put sources beside consequential claims. | Unsourced “verified” conclusions or lengthy AI explanations. |
| [Vercel generated URLs](https://vercel.com/docs/deployments/generated-urls) and [Netlify Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/) | Some preview links follow new builds; others identify a particular version. | A stable CloseSpan review page, with feedback bound to the exact tested deployment. | Treating a moving preview URL as proof of what the reviewer tested. |

The shared lesson is **list → focused detail → evidence or action**. The test-and-confirm workflow is our application of these patterns, not a feature established across all these competitors.

## 2. Proposed navigation and hierarchy

### Issues: the default destination

Header: **Issues**, search, **Add call**. Below it: **All / Needs you**, plus a component filter. Avoid a dashboard of counts above the actual work.

Start on All, with actionable issues first. Remember the user's selected filter. A new user should still see that their call is being analyzed, rather than an empty Needs you queue that suggests nothing happened. “Needs you” means an actual decision is waiting—not merely that an agent is working.

Keep four columns initially:

| Issue | Component | Customer | Status |
| --- | --- | --- | --- |
| CSV export drops filters | Reporting | Acme | Ready to test |
| Invite email never arrives | Team access | 3 customers | Investigating |
| Export saved views | Reporting | Northstar | Needs information |

Examples are fictional. Titles should describe the subject and distinguishing behavior, usually in a few words. Do not force a word limit that removes an important condition. Preserve the customer's full account in source evidence.

Do not show confidence percentages, internal IDs, prompt revisions, runtime providers, repository hashes, ARR, or classification explanations in the list. Put dates and full provenance in detail unless pilot users demonstrate a frequent need for them in the queue.

Use a real title link, visible status text, and a subtle row hover. Avoid several competing row buttons, icon-only essential actions, nested interactive elements, and click targets that intercept normal link behavior.

### One issue detail page

For the first MVP, prefer a **deep-linkable full page** with Back preserving filters and scroll. This leaves room for clear test instructions and works consistently on smaller screens.

[Linear Peek](https://linear.app/docs/peek) provides a useful fast-review precedent, but its documented interaction is keyboard-based; it is not evidence that every product should use a drawer. A desktop side panel is a later optimization if pilots show heavy serial triage. Do not implement both patterns initially.

Illustrative structure—not a visual mockup:

```text
← Issues                                      Ready to test

CSV export drops filters
Reporting · Acme

Reported
The downloaded CSV includes rows excluded by the date filter.

Finding
Reproduced in the test environment. The proposed fix passed
the same scenario.                              View evidence

Test the fix
1. Filter the report to this month.
2. Export CSV and check its dates.

[Open test]                  Test environment · Not live

Works as expected    Needs changes    Unable to test

Source: Acme call, Sep 18                         Ask CloseSpan
```

Use only sections supported by actual data. The illustrated finding must not appear just because code analysis or a unit test succeeded.

The primary emphasis changes with the task: initially Open test, then the review outcome. Saving feedback must not merge a PR or publish a deployment. If existing policy requires approval before paid execution or coding, present that approval when relevant; hiding internal controls does not remove authorization requirements.

### Components: the product relationship view

Use a simple list: **component name · open issues · affected customers**. Selecting a component opens its short description and related issues using the same issue-detail pattern.

Name components in product language—Reporting, Team access, Billing—not repository folder paths. Support multiple affected components and Unmapped when evidence is insufficient. A brief “Why linked” explanation belongs with the relationship, not every list row. Users can change a suggested association; confirming that association does not confirm a bug.

No graph canvas, dependency map, prioritization model, or roadmap builder in the first release. Test whether “Components” or “Product areas” is clearer with CS participants before settling the label.

Settings remains a secondary destination for integrations, access, appearance, and administrator-controlled execution policy. The public landing page and public Requests board remain separate, unchanged surfaces.

## 3. Call intake without another operations dashboard

**Add call** opens a short form: paste summary/transcript or upload a supported file, with customer and call date. Show only fields the system cannot reliably infer, and allow corrections. Start with text-based summaries/transcripts; do not imply audio/video ingestion until that capability is implemented.

After submission, show a durable, compact processing item and let the user leave. Provide a source-history link for finding prior uploads, including calls that produced no issues. When processing finishes, show the resulting issues and any clarification genuinely needed.

Group repeated reports around an existing issue while preserving individual sources. Let a person correct a mistaken merge or split. A summary is not a verbatim quotation; label source excerpts accurately and never fabricate recording timestamps.

Repository setup is an administrator task, not something a CSM repeats for each call. If context is unavailable, explain the consequence briefly and route setup to the authorized person. Uploading a file must not silently authorize code execution, production testing, or a paid sandbox.

## 4. Findings and test results must mean specific things

Replace the catch-all “Verified” label with a precise finding:

| Evidence available | Honest finding |
| --- | --- |
| Customer report only | Reported |
| Relevant code or documentation, no runtime reproduction | Code evidence found; not reproduced |
| Recorded failure in a specified environment/version | Reproduced |
| A test could not produce the reported failure | Not reproduced in this test |
| Proposed build passed the relevant check | Fix passed checks |
| Domain expert accepted a specific test build | Confirmed in preview |
| The fix's production deployment is established | Released; with live link |

These are evidence distinctions, not seven badges to place on every issue. The queue gets one useful work status; details supply the finding and environment. “Not reproduced” is not “not a bug.” A feature request requires validation of the expected behavior, not proof that existing behavior is defective.

Recommended task-dependent responses:

- Understanding a feature request: **Confirm request / Edit**.
- Checking a reported bug: **I see the issue / Can't reproduce / Unable to test**.
- Testing a proposed fix or feature: **Works as expected / Needs changes / Unable to test**.

“Needs changes” allows a brief explanation and optional evidence. Show the saved outcome and allow correction. Keep Ask CloseSpan secondary and scoped to the issue; it should help clarify requirements, not require users to invent prompts for ordinary workflow steps. Display concise findings and supporting evidence, not raw internal model reasoning.

## 5. Design the preview as a dependable product feature

The stable URL belongs to the CloseSpan issue/review page. Behind it, retain the deployment identity, relevant route, test steps, environment, and reviewer outcome. Moving branch previews and immutable deployment links serve different purposes. [Vercel URL types](https://vercel.com/docs/deployments/generated-urls), [Netlify preview URLs](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)

Access is distinct from a successful build. Check or communicate known sign-in requirements, test-account prerequisites, and unavailable environments. Sharing mechanisms vary; a reviewer should not discover an unexplained authentication failure after being told the test is ready. [Vercel sharing](https://vercel.com/docs/deployments/sharing-deployments)

Open the external app in a new tab, with that behavior indicated. Keep the stable review page open for instructions and feedback. Default embedding creates cross-origin framing and authentication problems; a blocked frame does not prove the app failed. [Chrome framing guidance](https://developer.chrome.com/docs/lighthouse/best-practices/clickjacking-mitigation)

Handle Preparing, Ready, Access required, Failed, and Expired/unavailable explicitly. Never leave an expired link as an apparently working primary action. Show an expiry only when it is reliably known; retain results after the environment is gone. Providers document retention/deletion policies, so unlimited availability cannot be assumed. [Vercel retention](https://vercel.com/docs/deployment-retention), [Netlify deploy retention](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)

If the deployment changes, keep the earlier review but request review of the new version. Do not transfer a green result silently. Passing checks, human acceptance, merge, and production deployment are different facts. GitHub models deployments with environments, commits, statuses, and environment URLs. [GitHub deployment history](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/view-deployment-history)

### Local implementation finding

The current executor stores a runtime preview URL, then its `finally` block closes the application runtime and sandbox session. Runtime cleanup unexposes the port. A URL recorded during execution is therefore **not a dependable post-run human-review environment**.

Relevant code: [coding executor](../src/lib/tenki-coding-executor.ts), around lines 1525–1565; [runtime cleanup](../src/lib/tenki-runtime-environment.ts), around lines 1007–1038.

Prefer an existing staging/PR deployment when the customer's project supports one. Otherwise a review preview needs a distinct, authenticated lifecycle tied to a version, with an explicit time/cost limit, cleanup, and a way to request a new preview. Do not keep execution VMs running indefinitely. A remote VM's localhost address alone is not a shareable review link; it requires a controlled reachable endpoint.

A live-production link may be offered for viewing an established release. It must not quietly trigger mutating reproduction tests against customer production data.

## 6. Preserve our theme, reduce visual competition

The current [DESIGN.md](../DESIGN.md) and [product theme](../src/app/product-theme.css) remain visual authorities. This research does not propose replacing them.

| Element | CloseSpan treatment |
| --- | --- |
| Surfaces | White/light neutral by default; honor saved Dark/System preferences. No new gradients or nested raised cards. |
| Type | Existing Geist: 28px page heading, 17px section title, 14px body, 13px labels. Never shrink important content just to make it fit. |
| Separation | Quiet 1px dividers; grouped spacing instead of borders around every fact. |
| Selection | Subtle neutral-gray background. One clear keyboard-focus indicator; no outer-and-inner double rings. |
| Controls | Existing compact buttons and rounded fields; consistent sizes, labels, and error placement. |
| Status | Restrained color plus readable text. Green only for the particular success actually established. |
| Shell | Expanded desktop sidebar; stable header; main content scrolls without dragging the sidebar away. |
| Motion | Brief, nonessential feedback only. Keep gooey effects away from text, tables, and reading surfaces; respect reduced-motion preferences. |

Use one dominant action per task state. Reserve secondary actions for alternatives such as Ask CloseSpan and View evidence. A form should have labels; minimalist design does not mean placeholder-only inputs or hiding critical consequences.

Do not replace long text with a forest of accordions. Remove redundant prose from the primary view, keep necessary decision context, and provide deliberate source/detail destinations. Essential warnings such as “Test environment · Not live” remain visible.

## 7. Accessibility and interaction requirements

- Normal text should meet 4.5:1 contrast; qualifying large text has a 3:1 minimum. Evaluate actual light/dark/accent combinations rather than assuming neutral colors are accessible. [Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- WCAG 2.2 AA target size is 24×24 CSS pixels, with defined exceptions including spacing. Our proposed 40px desktop fields and 44px touch controls are product choices, not a claim that AA requires 44px everywhere. [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Maintain visible keyboard focus and prevent sticky headers/actions from hiding focused controls. Use native links/buttons and proper dialog focus handling. [Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- Announce processing completion, saved feedback, and errors through appropriate accessible status messages without moving focus unnecessarily. Avoid announcing every agent log entry. [Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- At narrow widths, stack the issue fields and use the same detail route. Support reflow down to 320 CSS pixels and zoom without page-wide horizontal scrolling, apart from genuine two-dimensional exceptions. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- Keep hover-only information and keyboard shortcuts optional. All required actions must have a discoverable visible equivalent. Test long titles, translated labels, zero/one/many results, and high zoom.

## 8. Design failure and recovery—not just the happy path

| Situation | Minimal useful response |
| --- | --- |
| First visit | Add call, with one short explanation of accepted input. |
| Processing | Named activity and honest last update; user can leave. No invented percentage or endless unexplained spinner. |
| No issues found | Say so; preserve source and offer correction/manual issue creation. |
| Duplicate upload | Identify the existing call; allow intentional continuation where appropriate. |
| Analysis failed | Preserve the upload and offer retry or a specific corrective action. |
| Missing repository access | Keep customer evidence; indicate investigation is limited and route access setup to an admin. |
| Missing requirements | Ask one focused question in the issue, not a technical checklist. |
| Search has no matches | Clear filters without losing underlying issues. |
| Preview unavailable | Explain the state and offer a valid recovery action, not a dead test link. |
| Review save fails | Preserve the response for retry; do not display acceptance prematurely. |

Content access must remain workspace- and role-scoped. Source links are not automatically public because they appear in a shareable issue. Logs, tokens, and confidential repository details do not belong in user-visible errors.

## 9. Validate before expanding

Use a small formative pilot with the PM and 3–5 CS participants. This is a practical first iteration, not a statistically representative study.

Give participants realistic calls and ask them to:

1. Add a summary and find the resulting issue without guidance.
2. Identify the affected product area and correct one mistaken association.
3. Explain the agent's finding and find its supporting source.
4. Open a proposed fix, follow the steps, and record that it still needs changes.
5. Explain whether that fix is in a test environment or live for customers.

Observe task completion, hesitation, wrong destinations, misunderstood status, source-trust questions, and corrections—not just whether they like the screen. Include keyboard-only and narrow-screen checks.

Initial hypotheses to test: users can identify the next action within five seconds of opening an issue; routine paths need no explanation of prompts/sandboxes; no participant confuses preview acceptance with production release. These are proposed acceptance targets, not published industry benchmarks.

## Proposed scope for confirmation

- Two daily views, Issues and Components; call intake and source history inside that experience.
- One concise issue-detail pattern, contextual agent discussion, and version-specific test feedback.
- Existing theme, landing page, public Requests page, integrations, data, and authorization safeguards preserved.
- No dashboards, graph canvas, roadmap suite, prompt-management screens, or default engineering diagnostics.
- Open product decision: investigate and verify engineering-supplied fixes first, or also generate fixes under the existing approval policy. The UX can accommodate either; research has not authorized changing that policy.

Next step, only after direction is confirmed: prototype the queue, detail, and component relationships with representative states, then validate them before wiring more backend operations into the interface.
