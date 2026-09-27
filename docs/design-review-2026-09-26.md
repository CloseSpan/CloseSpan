# Product style review — September 26, 2026

## Verdict

The confirmed shared styling defects are fixed locally. Confidence is high for the rendered controls and shared surfaces checked, not a claim that every possible authenticated role, backend result, or browser state has been exercised. The Attio-inspired identity, landing-page layout, and workflow behavior are preserved.

## Findings and fixes

| Severity | Evidence before the fix | Impact | Implemented correction |
| --- | --- | --- | --- |
| P1 | `/feedback`, dark theme, 1677px: a checked checkbox used a fixed white SVG over the light accent fill. | The selected state could appear blank. | Theme-aware mask using `text-on-accent`; visible unchecked border; explicit indeterminate and forced-color states. |
| P2 | Account menu, 1677px: theme track was 88×36px with a 36px thumb starting 4px below its top; generic menu styles gave the track a 6px radius. | The thumb protruded and the control looked clipped. | Track-owned dimensions and pill radius, proportional thumb, neutral boundary, preserved keyboard focus. Confirmed 80×40/30px thumb on desktop and 88×44/34px thumb on mobile. |
| P2 | `/overview`, light theme, 1677px: all seven main cards and the canvas were white. | Panel hierarchy was weak. | Shared gray panel fill `#f6f6f7` and single boundary `#e1e2e5`; dark panels retain their separate charcoal surface. Applied to workspace panel families, not the landing page. |
| P2 | `/integrations`, both themes: active and inactive view tabs had the same computed background. | Current view was difficult to identify. | Transparent inactive choices; bounded selected surface; shared hover and selected rules across tab families. |

Source inspection also found fixed-size geometry in settings switches. These now have a consistent 44×26px track and 18px thumb, with contrasting on/off foregrounds.

## Cross-app system

- `product-theme.css` remains the final component authority. The fixes target shared roles rather than repeating page-specific overrides.
- Inputs and overlays remain brighter than workspace panels; table bodies retain their readable surface. Semantic success/warning/error colors are unchanged.
- Interaction is limited to quiet hover/press feedback; no new looping animations, shadows, or page transitions were added.
- The quick switch retains native button/switch semantics, accessible naming, checked state, and keyboard operation. Forced colors and reduced motion were checked.

## Coverage

Desktop viewport: 1677×963. Narrow viewport: 390×844. Browser: Chrome. Data: existing read-only demo workspace. Inspections combined source review, DOM/computed styles, control geometry, and screenshots at representative states. The route sweep found no document-level horizontal overflow; intentionally scrollable tables are not treated as overflow defects.

| Route or family | Coverage |
| --- | --- |
| `/overview` | Desktop/mobile light; mobile dark; populated metrics/chart and empty emerging-themes state; updated panel colors measured. |
| `/feedback` | Desktop/mobile; light/dark checkbox states; selected checkbox reset without submitting analysis. |
| `/problems`, `/problems/prob_demo_export` | Desktop/mobile populated list and issue detail; shared controls and panel layout. |
| `/pdd`, `/pdd/prob_demo_export` | Desktop queue/detail; mobile queue; blocked readiness states. `/investigations` and `/prioritization` redirect to `/pdd`. |
| `/approvals` | Desktop/mobile; pending/history controls, populated review queue, disabled demo actions. No approval submitted. |
| `/agent-runs`, one existing demo run detail | Desktop list/detail; mobile list. No run started. |
| `/customers`, `/follow-up`, `/notifications` | Desktop/mobile route and control checks. |
| `/integrations` | Desktop/mobile; both view tabs, light/dark surfaces, populated connection cards. No source connected or synced. |
| `/settings`, `/settings/appearance`, `/settings/technical` | Desktop; mobile Settings/Appearance. Theme selection, account-menu toggle, keyboard operation, forced colors and reduced motion. Technical settings inspected in demo Viewer context. |
| `/onboarding` | Shared switch/composer/workspace-selector source reviewed. This turn did not repeat live setup or submit onboarding messages. |
| `/`, `/requests` | Desktop/mobile checks; landing-page design unchanged. |
| `/about`, `/connectors`, `/contact`, `/resources`, `/security`, `/privacy`, `/terms` | Desktop route/layout/control inspection. |
| `/customer-feedback-to-engineering`, `/customer-feedback-operations`, `/support-ticket-analysis`, `/close-customer-feedback-loop`, `/use-cases/product-operations` | Desktop public-page family inspection. |
| Four `/guides/*` pages and `/templates/customer-defect-evidence-brief` | Desktop document-family inspection. |
| `/login`, `/waitlist` | Redirected to Overview in the signed-in browser; shared authentication CSS was reviewed, but the logged-out forms were not rendered. |
| Admin-only pages, alternate data-dependent details, destructive/error/provider flows | Not executed. Shared CSS reviewed, but these states are not claimed as fully visually verified. |

35 distinct rendered routes, with 38 desktop and 22 narrow route checks (including repeat checks before/after fixes). This is representative rendered coverage plus shared-component review, not exhaustive validation of every element in every runtime state. Safari and Firefox were not exercised.

## Verification

- Full in-memory suite: **2,188 passed, 2 skipped** across 314 passing test files and 2 skipped files.
- TypeScript typecheck: passed.
- ESLint on the edited test file: passed.
- `git diff --check`: passed.
- Added regression assertions for panel contrast, switch geometry, checkbox foreground/masks, and selected-tab treatment.
- Desktop and mobile theme-thumb containment: passed.
- Keyboard switch activation and visible 2px focus outline: passed.
- Forced-color system boundary/foreground and reduced-motion transition checks: passed.
- Existing demo workspace and Light/Neutral appearance restored after verification. Temporary viewport/media overrides cleared.

## Remediation sequence completed

1. Restore visible selection states and switch geometry.
2. Establish shared light/dark panel hierarchy and tab states.
3. Verify representative responsive routes, accessibility modes, and regression tests.

No backend data, provider permissions, sandbox jobs, approvals, commits, pushes, or deployments were changed by this style review.
