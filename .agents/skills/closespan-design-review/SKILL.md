---
name: closespan-design-review
description: Review CloseSpan's complete product UI for visual consistency, usability, responsive behavior, accessibility, interaction states, and production readiness. Use when asked to audit or critique the overall app, review a screen or new feature, compare design quality across routes, inspect desktop and mobile layouts, validate glassmorphism, prioritize UX defects, or verify design fixes.
---

# CloseSpan Design Review

Review the working product, not a static demo. Inspect implementation and rendered behavior, then report evidence-backed findings without changing code unless the user explicitly requests fixes.

## Review workflow

1. Read repository instructions and identify the UI framework, global styles, shared components, authenticated shell, and public layouts.
2. Confirm the local app is running. Start it only when needed and authorized.
3. Build a route inventory from the application source. Cover the route groups in [review-checklist.md](references/review-checklist.md); add newly discovered user-facing routes.
4. Use the browser-control skill for rendered inspection. Reuse an existing localhost tab when available.
5. Review representative routes at desktop and narrow/mobile widths. Inspect navigation, overlays, forms, loading, empty, error, success, disabled, hover, focus, and selected states when reachable without destructive actions.
6. Check the implementation for shared-token use, duplicated styling, responsive breakpoints, semantic markup, keyboard support, focus visibility, reduced-motion/transparency handling, and likely contrast failures.
7. Run appropriate non-mutating checks such as lint, typecheck, tests, and an overflow audit. Never treat passing code checks as proof of visual quality.
8. Produce the report in the format below. Separate observed defects from suggestions.

## Review standards

- Preserve CloseSpan's product hierarchy and restrained visual language.
- Treat glassmorphism as a surface system, not decoration. Require readable contrast, visible boundaries, sensible blur, and opaque fallbacks.
- Prefer shared tokens and components over route-specific patches.
- Judge production states, real data density, long labels, validation errors, and small screens—not only seeded happy paths.
- Do not invent findings. State routes, viewport, state, and evidence for each issue.
- Do not modify code during a review-only request. When fixes are requested, address the highest-severity systemic causes first and repeat the affected review checks.

## Severity

- `P0 Blocker`: Prevents task completion or creates severe accessibility, privacy, or destructive-action risk.
- `P1 High`: Major navigation, readability, responsive, or interaction failure affecting common workflows.
- `P2 Medium`: Noticeable inconsistency or friction with a clear user impact.
- `P3 Low`: Polish improvement with limited task impact.

## Required report

Lead with an overall verdict and confidence level. Then provide:

1. Findings ordered by severity, each with route/state, viewport, evidence, user impact, and recommended correction.
2. Cross-app system issues, including tokens, components, navigation, responsive behavior, and accessibility.
3. Coverage table listing routes and states inspected, including anything blocked or not authenticated.
4. Checks run and their results.
5. A short prioritized remediation sequence.

If no defects are found, say so explicitly and identify remaining coverage gaps or risks. Avoid generic praise and avoid scoring the design unless the user requests a score.

