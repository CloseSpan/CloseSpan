---
target: focused PDD prompt comparison workflow
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-12T08-40-10Z
slug: src-components-engineering-ticket-panel-tsx
---
# PDD prompt comparison critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Strong phase and result states, but a saved proposal may look ready while Apply is unavailable. |
| 2 | Match system / real world | 2 | PDD, immutable, SHA, and `.prompt` assume specialist knowledge. |
| 3 | User control and freedom | 2 | No explicit keep-current, reject, revert, or visible revision history action. |
| 4 | Consistency and standards | 3 | Cohesive UI, but the two default English panes show different content types. |
| 5 | Error prevention | 2 | Traceability is strong; visible safety framing and post-apply recovery are weak. |
| 6 | Recognition rather than recall | 2 | Users must mentally compare full prompts, especially after mobile stacking. |
| 7 | Flexibility and efficiency | 1 | No actual diff, synchronized view mode, copy control, or compact power-review mode. |
| 8 | Aesthetic and minimalist design | 2 | Restrained palette, but nested full-text cards and repeated recommendations add noise. |
| 9 | Error recovery | 3 | Retry and blocker states are good; post-apply recovery is missing. |
| 10 | Help and documentation | 1 | The workflow lacks contextual decision guidance and terminology help. |
| **Total** |  | **21/40** | **Acceptable; significant improvement needed** |

## Design Specificity Verdict

The workflow has medium-high CloseSpan specificity through PDD phases, immutable revisions, SHA provenance, and approval framing. The core interaction is not yet decision-grade. It uses a generic two-card comparison pattern without exposing the product-specific evidence a reviewer needs: exact deltas, acceptance-test impact, unresolved risk, and a safe decision path.

The deterministic detector returned `[]` for `src/components/engineering-ticket-panel.tsx`; there were no rule findings or false positives. Browser injection was unavailable because the browser evaluate surface was read-only, so no reliable overlay was shown. Rendered and source evidence still exposed the interaction issues below.

## Overall Impression

The screen feels credible on entry but becomes laborious at the decision point. Its biggest opportunity is to replace side-by-side document reading with a change-first review brief and a safe, explicit decision footer.

## What Is Working

1. Revision numbers, SHA badges, and immutable/applied states provide unusually strong provenance for an AI-assisted workflow.
2. Problem context and the three-phase rail orient the reviewer before prompt work begins.
3. English/raw modes, technical-detail disclosure, progress semantics, no-op handling, and blocker states show strong state coverage.

## Priority Issues

### P1 — The default comparison is not like-for-like

The tested card's English mode renders the ticket specification, while the proposed card renders a PDD summary and recommendations. The side-by-side composition promises before/after comparison, but exact comparison requires switching both panes independently to raw prompt and manually scanning them.

**Fix:** Replace the default with `Summary | Changes | Full prompt`. Make Changes a semantic unified diff that highlights additions, removals, and modifications and maps them to user-story or acceptance-criterion clauses. Use one synchronized mode control.

### P1 — Decision evidence and safety framing are in the wrong order

Apply is rendered before both long prompt panes, while “What PDD changed” appears after them. There is no visible Keep current, reject, revert, or revision-history action, and the copy does not state whether applying runs code.

**Fix:** Lead with a compact review brief: verdict, why, changed/unchanged scope, acceptance-test impact, and unresolved questions. Follow it with the diff, then a sticky decision footer containing `Apply revision 25` and `Keep revision 24`. State: “Creates a prompt revision only; no code runs. Revision 24 remains in history.”

### P1 — A saved proposal can look actionable when it is not

The proposed card can be reconstructed from persisted workflow data, but Apply depends on an in-memory background-task receipt. On revisit, the page can show Needs revision and Ready to apply without an Apply action or explanation.

**Fix:** Persist the actionable receipt, or render an explicit expired/read-only state with `Run PDD again`. Never render Ready to apply unless Apply is available.

### P2 — Mobile creates an extreme memory bridge

The comparison collapses into two long sequential documents at narrow widths. The user must remember revision 24 while reading revision 25 and then continue to the change list.

**Fix:** Show the unified diff first on mobile. Put full revisions behind disclosures and keep the decision footer available after evidence review.

### P2 — Touch and spoken status need refinement

The English/`.prompt` controls measure about 30px high on mobile, and the phase rail does not expose complete/upcoming states in accessible labels.

**Fix:** Use at least 44px touch targets, rename `.prompt` to `Raw prompt`, and announce “Step 1 of 3, complete/current/upcoming.”

## Cross-System Issues

- Stabilize terminology around `Current revision` and `Proposed revision`; remove the mix of suggested, agent-written, tested, proposed, and current.
- Create a shared revision-decision component for action availability, expired-review messaging, safety copy, and recovery.
- Keep the existing progressive-disclosure and status components; they are solid foundations.
- Review the PDD list/detail readiness derivation: one browser-observed task was labeled Approval ready and Complete investigation in the list but opened an Investigation required blocker.

## Persona Red Flags

**Alex, power reviewer:** No diff, synchronized panes, copy action, keyboard shortcut, or compact review mode. Reviewing a revision requires manual raw-text scanning.

**Sam, accessibility-dependent:** Focus and pressed states are present, but 30px mobile controls and incomplete phase-status announcements reduce operability and orientation.

**Casey, distracted mobile reviewer:** Evidence is separated by multiple screens of scrolling, and Apply is positioned before the evidence it authorizes.

## Minor Observations

- “Needs revision” and “Ready to apply” appear contradictory; use “Revision 24 did not pass” and “Revision 25 proposal.”
- SHA is visually prominent but has no copy affordance or explanation.
- The proposed outline communicates emphasis, not change magnitude.
- Long raw prompts wrap safely with no horizontal overflow.
- The fixed Guided demo widget can overlap narrow-screen content.

## Coverage

| Route/state | Viewport | Result |
|---|---:|---|
| Requested post-context comparison record | desktop | Record unavailable; evaluated supplied screenshot and exact source state. |
| `/pdd` prioritization | desktop | Inspected route discovery and readiness labels. |
| `/pdd/prob_demo_export` focused prompt | 1280×720 | Inspected context, phase rail, prompt viewer, editor, controls, and semantics. |
| Same focused prompt | 390×844 | No page overflow; inspected stacking, long prompt, touch sizes, and fixed overlay. |
| Pending/applied/error comparison states | source | Reviewed rendering gates, Apply path, change cards, technical details, and responsive CSS. |

## Questions to Consider

1. What evidence should let a reviewer approve a proposal without reading either full prompt?
2. Should keeping the current revision be an explicit decision recorded in history?
3. Is the primary artifact a prompt, an implementation contract, or an acceptance-test delta?
