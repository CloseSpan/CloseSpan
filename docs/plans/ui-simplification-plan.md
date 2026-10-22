# UI simplification plan

Status: approved · Phase 0 in progress · 2026-10-21

Two streams: **simplify the sidebar and concepts** (what users see) and **consolidate CSS and shared components** (how it is built). They are planned together because simplifying first removes screens that would otherwise need restyling.

## Where things stand

**Navigation.** The sidebar has 10 items in three groups ([workspace-navigation.ts](../../src/lib/workspace-navigation.ts)): Overview, Customers · Feedback inbox, Issues, Prompt Testing, Action approvals, Agent activity, Follow-up · Integrations, Settings. The design docs describe something much smaller:

| Source | Intended primary navigation |
| --- | --- |
| [DESIGN.md:193](../../DESIGN.md) | Issues, Needs your review, Settings |
| [issue-workspace.md](../issue-workspace.md) | Issues, Needs your review, Settings (integrations inside Settings) |
| [customer-success-ux-research.md](../customer-success-ux-research.md) | Issues and Components; calls are evidence, not a destination; no dashboard of counts above the work |

**Overlapping concepts.**
- Prompt Testing (`/pdd`) absorbs investigations and prioritization, which only exist as redirects. Its per-issue steps duplicate what the issue page shows.
- Follow-up only covers the workspace's primary issue (`follow-up/page.tsx` uses the legacy single-issue state).
- The issue page has two render paths: `ProblemWorkspace` for the primary issue and `GenericProblemScreen` for every other issue.
- Integrations exists at `/integrations` and again at `/settings/connections`.
- "Action approvals", "Needs review" (an issue stage), "Needs your review" (docs) and "Needs attention" (three different meanings) overlap.

**Styling.** Three global stylesheets load in order ([layout.tsx](../../src/app/layout.tsx)):

| File | Lines | Role today |
| --- | --- | --- |
| `globals.css` | 3,393 | Original indigo/navy theme and layout; 744 hard-coded colours, no dark mode |
| `neumorphic-theme.css` | 14,792 | Despite the name, holds the current flat tokens, dark mode and most component styling |
| `product-theme.css` | 1,120 | Late overrides using `:root[data-theme]` specificity and `!important` |

Together they use 215+ `!important`, 39 corner radii, 49 font sizes and 19 font weights. There are no shared Button, Badge, EmptyState or PageHeader components; `screens.tsx` is 5,707 lines with 23 exported screens.

## Decisions

1. **Sidebar:** Issues (home) · Needs you · Feedback · Settings.
2. **Overview:** dropped; Issues is the home page.
3. **Delivery:** one branch and pull request per phase, merged after review.

## Phase 0 · Safety net (½ day)

`npm run test:visual` captures 15 workspace screens in light and dark mode at 1440px wide and compares them with the images in `e2e/__screenshots__/`. After an intended visual change, review the new images and accept them with `npm run test:visual -- --update-snapshots`.

How it stays safe and repeatable ([playwright.config.ts](../../playwright.config.ts), [visual.spec.ts](../../e2e/visual.spec.ts)):
- The app runs in-memory against the seeded "CloseSpan Demo" workspace, with every persistence setting passed explicitly, so a local `.env` pointing at a real database is never used. Each test also fails unless the page shows the demo workspace.
- Sign-in uses a session cookie minted with a secret that exists only in the config; no Google account is involved.
- The server and browser clocks are pinned to 7 January 2030, because seeded data and charts are dated relative to "now". `<time>` elements are masked.
- A page showing the route error screen fails its test even though it responds 200.
- The presentation walkthrough is kept closed so it does not cover the screens.

Limits: baselines are rendered on macOS by Playwright's bundled Chromium, so run them on a Mac. Stop any other `next dev` in the same checkout first; two dev servers cannot share `.next`.

## Phase 1 · Simplify concepts and navigation (3–5 days)

Target sidebar (recommended):

| Item | Contains | Replaces |
| --- | --- | --- |
| **Issues** (home) | List/board with All · Needs attention · In progress · Closed; customer and component filters | Issues, Overview, Customers (as a filter and issue column) |
| **Needs you** | Every decision waiting on a person: requirement reviews and action approvals | Action approvals, issue-review badge |
| **Feedback** | Incoming calls and tickets awaiting triage | Feedback inbox |
| **Settings** | Connections, automation, members, appearance, and a secondary Activity log | Integrations, Agent activity, Settings |

Steps:
1. **Vocabulary first.** Add a short glossary to DESIGN.md and use it everywhere: *Needs you* = a decision a person must make; *Needs attention* = an issue-list filter only; one list of issue statuses. Rename labels in `workspace-labels.ts` and badge counts in `app-shell.tsx`.
2. **One issue page.** Make `GenericProblemScreen` handle every issue and retire the primary-issue `ProblemWorkspace` path. Move the Prompt Testing stepper and the Follow-up drafts into sections of that page, so they work for every issue, not just the primary one.
3. **Needs you.** Merge requirement reviews and action approvals into one queue, sorted by urgency, each row linking to the decision on the issue page.
4. **Move secondary screens.** Agent activity → Settings › Activity (findings still appear on their issues). Integrations → Settings › Connections only. Customers becomes an Issues filter and column.
5. **Redirect old URLs** (`/overview`, `/pdd`, `/follow-up`, `/approvals`, `/agent-runs`, `/integrations`, `/customers`) so bookmarks and notification links keep working, and update `workspace-navigation.ts` and its tests.
6. Update DESIGN.md, issue-workspace.md and the tests that assert sidebar items.

Risk: pages being folded in carry behaviour (prompt testing, follow-up drafts) that tests cover per screen. Move the components rather than rewrite them, so existing tests keep applying.

## Phase 2 · Split `screens.tsx` and add shared components (3–4 days)

1. **Mechanical split.** Move each exported screen from `screens.tsx` into its own file next to its route or under `src/components/screens/`, sharing helpers from a small module. No behaviour or markup changes; Phase 0 screenshots must match exactly.
2. **Shared primitives** in `src/components/ui/`:
   - `Button` (variants: primary, secondary, ghost, danger; sizes: sm, md) wrapping the existing `.btn` classes at first.
   - `StatusBadge` with tones `success | warning | danger | info | neutral`, replacing mixed `high` / `medium` / `brand` modifiers.
   - `EmptyState` (icon, title, description, action), replacing about 20 one-off empty-state classes.
   - `PageHeader` (title, description, actions), replacing `page-head`, `page-title-actions`, `immersive-topbar` and others.
   - `Card`, `Skeleton`, and the existing `ConfirmActionButton`.
3. **Migrate usages** screen by screen, starting with the Phase 1 survivors. Add a lint rule (or a test) that flags new raw `className="btn …"` and `badge …` strings outside `ui/`.

## Phase 3 · Consolidate CSS (5–7 days)

1. **Cascade layers.** Wrap the files in `@layer reset, tokens, base, components, overrides;` so order, not specificity or `!important`, decides what wins. This alone should allow most `!important` to be deleted.
2. **Split by role and rename:**
   - `tokens.css`: colours, spacing, radii, type and shadows for light and dark, taken from `neumorphic-theme.css`.
   - `base.css`: element defaults and the app shell.
   - Component styles co-located with the Phase 2 primitives as CSS modules.
   - Remove the "neumorphic" name; mark docs/NEUMORPHIC-DESIGN-SYSTEM.md as historical.
3. **Scales.** Font sizes `--text-xs` … `--text-xl` (11px floor), weights 400/500/600, a 6-step radius scale. Add a script that rewrites raw values to the nearest token and flags outliers for manual review.
4. **Delete dead CSS.** Add a script listing selectors never referenced from `.tsx` files (some already known: `.fit-*`, `.preview-*`, `.signal-connector`). Retire the old indigo palette in `globals.css` once nothing depends on it.
5. **Guardrails.** Add stylelint rules: no hex colours outside `tokens.css`, no `!important` outside `overrides`, values from the scales only.
6. Move the Geist font off the private `node_modules/next/dist/…` path to the `geist` package or `next/font`.

Each step lands separately and must pass the Phase 0 visual diff.

## Phase 4 · Finish (1 day)

- Route-level `loading.tsx` skeletons for issue, approval and run detail pages.
- Delete the empty leftover folders under `src/app/` and the reset-mode screen if it is no longer needed.
- Final docs pass so DESIGN.md describes the shipped app.

## Order and effort

| Phase | Effort | Visible change |
| --- | --- | --- |
| 0 Safety net | ½ day | None |
| 1 Concepts and navigation | 3–5 days | Large: new sidebar, merged queue, one issue page |
| 2 Split and primitives | 3–4 days | Small: consistent buttons, badges, empty states |
| 3 CSS consolidation | 5–7 days | None intended |
| 4 Finish | 1 day | Small |

Phase 1 goes first because every screen it removes is one fewer to migrate in Phases 2 and 3. Phases 2 and 3 can overlap once the primitives exist.

## Not in scope

New features, a Components data model (unless chosen in decision 1), mobile layouts (the product is web-first), and marketing pages.
