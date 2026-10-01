---
name: CloseSpan
description: An Attio-inspired visual system for accountable feedback-to-fix work.
colors:
  accent: "#1c1d1f"
  accent-hover: "#36383c"
  bg: "#ffffff"
  surface-muted: "#f7f7f8"
  surface-panel: "#f6f6f7"
  border-panel: "#e1e2e5"
  surface-pressed: "#f0f0f2"
  text: "#404247"
  text-muted: "#62656b"
  border-subtle: "#e7e7e9"
  border-strong: "#d4d5d8"
  focus-ring: "#5267c8"
  link: "#4055ab"
  success: "#176b4b"
  success-soft: "#ecf7f0"
  warning: "#805517"
  warning-soft: "#fcf5e8"
  danger: "#b0333c"
  danger-soft: "#fff0f1"
  info-soft: "#eff2ff"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(42px, 5.25vw, 68px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 550
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.55
    letterSpacing: "-0.008em"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.accent}"
    rounded: "{rounded.lg}"
    padding: "9px 12px"
  nav-item:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  badge:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.xs}"
    padding: "3px 7px"
  card:
    backgroundColor: "{colors.surface-panel}"
    rounded: "{rounded.lg}"
---

# Design System: CloseSpan

## Overview

**Creative North Star: "Attio"**

The user-selected reference anchors a restrained white-and-charcoal interface with Geist typography, fine boundaries, and compact controls. Flat structural surfaces and a readable hierarchy keep customer evidence, approval state, and the next action visible. The pinned field reference adds round white inputs, search controls, and dropdown triggers with a shallow downward shadow.

Public pages give headlines and product demonstrations room to breathe; authenticated workspaces use denser records and persistent navigation. Both carry the flat CloseSpan `</>` wordmark. Light and neutral are the defaults; personal Appearance settings offer Light, Dark, System, and optional accent colors.

**Key Characteristics:**

- White and charcoal surfaces with thin neutral borders.
- Geist headlines, compact controls, and tabular data.
- Rounded fields with a fine neutral boundary and subtle downward depth.
- Expanded workspace navigation and quiet selected rows.
- Semantic colors for status, feedback, and consequences.

Recorded from the built CSS and real components. `src/app/neumorphic-theme.css` supplies shared tokens; `src/app/product-theme.css`, imported afterward, owns final component treatments and the field tokens. Public page modules supply local layout and typography. The frontmatter records the default light palette; runtime CSS variables supply dark overrides. Review evidence in `.impeccable/review/attio` includes live public pages and static fixtures made from real workspace components; fixtures do not verify authentication or backend workflows.

## Colors

The primary palette is neutral, with restrained color for meaning.

### Primary

Charcoal (`accent`) supplies primary action fills and strong text. Its lighter hover value changes state without adding depth. Links and action-button keyboard focus use the blue `link` and `focus-ring` roles. Text fields and dropdowns keep a neutral focus treatment regardless of the selected accent.

### Neutral

White (`bg`, also the light surface) frames content. `surface-muted` separates rails and supporting areas; `surface-pressed` marks selected or pressed content. `text` and `text-muted` distinguish body copy from secondary details. `border-subtle` outlines containers; `border-strong` defines action controls and stronger separation. Fields use `field-border` (#e4e5e8) and `field-border-hover` (#caced4), with dark overrides (#44464c and #666970). Their background follows `surface` in both themes.

Success green, warning amber, danger red, and informational blue each pair with a soft background. They communicate results, review needs, severity, or action consequences. Dark mode reassigns these semantic roles rather than inverting screenshots. The landing page has its own near-neutral palette in `landing-page.module.css`; reuse that local palette when extending that page.

The sidecar's derived tonal ramps are swatch-panel aids, not additional application color tokens.

Workspace panels use `surface-panel` (#f6f6f7 in light, #202124 in dark) and a single `border-panel` boundary (#e1e2e5 / #3b3d42). This makes overview metrics, attention queues, charts, approval panels, and integration cards distinct from the page canvas without restoring neumorphic shadows. Fields, table bodies, and overlays retain `surface`. The landing page's local palette is unchanged.

Keep the live light-mode palette: panels and headers share neutral #f6f6f7 with #e1e2e5 outlines, not blue-gray fills. Nested evidence metrics and facts use the white surface and the same panel border. Investigation subsections retain simple dividers. Semantic callouts keep their colors and gain a matching fine outline. Structural improvements must not introduce a new palette; dark mode and public pages remain unchanged.

Issue boards follow the supplied Attio reference: a quiet `surface-board` canvas (#f0f0f2 / #191a1d), near-white or charcoal `surface-board-column` lanes (#fdfdfd / #222326), and fine `border-board-column` outlines (#e1e2e5 / #3b3d42). The stage board has four summary columns: Open, In progress, Needs your review, and Closed. These fit the desktop width with 16px gutters, wrap to two columns at 1200px and one at 720px, and use content-sized lanes with a compact empty state. A colored stage dot accompanies a text label and compact count; color is never the only status cue. Tickets use `surface-ticket` (#ffffff / #2c2e32), a single `border-ticket` boundary (#d4d5d8 / #46494f), and a quiet hover fill (#fafafa / #34363b). Issue titles lead, followed by icon-aligned product area and reports, then type, severity, and the recorded lifecycle status. Move-stage actions retain their explicit destination picker and confirmation; summary columns are not drag targets because they do not map to a single lifecycle action.

Issues have two layouts, List and Board, over one shared filtered inventory. List is the initial view, including sparse workspaces. Product area and feedback type accompany each issue title instead of occupying a separate Classification tab. The list shows Issue, Stage, Severity and Reports; ARR, trends, confidence and investigation details belong inside the issue. Search and filters survive layout switches. Grouping supports product area, type and stage; an ungrouped list switches to the four-column stage board. All board sections retain their outlines. Nine backend stages remain unchanged: Detected, legacy intake Needs review, Approved, and Planned group under Open until work starts; implementation and release stages group under In progress until explicitly Closed. Needs your review requires a current requirement review or pending approval from the same sources and policy as Action approvals. Released or Verified does not imply closure. Detailed states remain available on cards, in issue details/history, filters, and the manual destination picker.

The issue inventory uses one compact desktop toolbar: title with result count underneath on the left, a centered search/filter/grouping cluster, and List/Board on the right. Equal-width side columns keep the controls truly centered. Clear filters is a labelled icon action when needed. The toolbar wraps at smaller widths without changing keyboard order; it has one bottom divider, not stacked header and controls rows.

The List/Board switch has a single visible outline and a deeper neutral track so it remains distinct from the shaded toolbar. Its selected pill uses the main surface color without a shadow in either theme.

Sidebar and mobile navigation keep the reference's 18px outline glyphs with 1.8px strokes: grid, people, inbox, circle-dot, flask, circle-check, robot, rounded follow-up connection, grid-plus, and gear. Navigation, settings, and other interface icons use the shared `icon-colors.css` palette without recoloring labels or surfaces: blue for general actions and grids, violet for agents, code and follow-up, teal for people, connections and settings, green for checks and testing, amber for attention, and red for destructive or error states. Dark mode uses brighter equivalents. Navigation icons retain their category colors on active and hover states. Error/warning/success containers override an icon's usual category; solid actions, disabled controls and forced-colors mode retain readable foregrounds. Company marks keep their brand colors. This refinement does not change layout or workflow.

**The State Meaning Rule.** Preserve semantic status and destructive-action colors when applying the neutral visual system.

Active navigation uses filled versions of the same colored icons; inactive navigation remains outlined. Inner checkmarks, dots, eyes and other identifying marks stay visible using the selected row's surface as a cutout. Apply this consistently to desktop, mobile and settings navigation, without filling icons on hover alone.

The topbar notification bell is a disclosure button, not a page link. It opens a compact, theme-aware dropdown with up to five review requests, unread indicators, and a persistent “View all” link to `/notifications`. Empty states retain that link. Opening previews never marks notifications read; Escape restores focus to the bell, and outside interaction dismisses the panel. On mobile, the panel fits within 16px viewport gutters.

### Personal appearance

`/settings/appearance` is available to every signed-in workspace member. Theme cards offer Light, Dark, and System; System follows operating-system changes while the app is open. Eight named accent choices—Neutral, Blue, Cyan, Amber, Orange, Pink, Purple, and Green—change interactive accents, links, focus rings, and selected navigation without changing success, warning, danger, or other status colors. Neutral restores the base palette. Each theme preview uses its own light or dark palette regardless of the active application theme.

Preferences apply immediately and persist in this browser through the shared local-storage and cookie model, including before the first paint. They are personal presentation choices, not workspace policy or cross-device account settings. Do not show a Save policy action here. Native radio groups, visible focus, named swatches, and 44px accent targets support keyboard and touch use. The page keeps the pinned three-card layout on narrow screens without horizontal overflow.

The account-menu quick switch owns its pill geometry: an 80×40px track on desktop and 88×44px on mobile, with a thumb inset by 5px. Shared menu-button rules must not override its radius. Tabs use transparent inactive choices and a bounded surface for the selected choice. Checkbox marks follow `text-on-accent`, including dark mode and forced colors, rather than using a fixed white image.

## Typography

Geist is loaded locally through the app layout and used for display, body, labels, and navigation. System monospace is reserved for code and technical values. Headlines use medium weights and tight tracking; tables and numerical badges use tabular figures.

The frontmatter's display role records the landing hero; headline and title record workspace page and card headings. Workspace headings reduce to (25px) on mobile. Public marketing and trust modules use their own responsive display sizes; they do not inherit workspace heading density. Body copy uses the shared body role, with more generous size and leading in public introductions.

## Layout

### Issue-centered workspace

The everyday sidebar contains Issues, Needs your review, and Settings. It remains expanded on desktop. Issues uses short subjects in a searchable list or board, without readiness filters, revenue metrics, confidence percentages, or preparation steppers. A review label requires an available decision; a legacy intake stage alone is not evidence that a person needs to act.

Issues offers All, Needs attention, In progress, and Closed as compact pressed-state queue controls with workspace-wide counts. Search narrows the chosen queue without changing those counts. All puts known attention states first; recorded release/verification does not imply active work or closure. Each row is one navigable link with subject, report count and severity, current status, and a short navigation cue. The attention filter is an issue-status view, not a replacement for the execution decisions in Needs your review.

Issue detail uses the subject, one current status, expected behavior, actual checks/result, and contextual actions. Successful criteria are summarized; unresolved criteria, production consequences, and failed release checks remain explicit. Current confirmed requirements must not be replaced by generic generated text. Original reports and full text are separate linked pages, not accordions. Technical prompts, infrastructure, logs, and audit records stay on diagnostic routes. Page transitions keep only one route mounted to avoid duplicate content and controls.

The issue header offers a contextual jump to the expected behavior, current result, or coding approval section, plus conversation access when available. These links only navigate. Requirement confirmation initially shows Confirm and Needs changes; choosing Needs changes opens an inline labeled feedback form with Send feedback and Cancel. Draft feedback is never attached to a confirmation. Source reports are linked once in the main context section, with a footer fallback when context is unavailable.

When conversation is available, the issue workspace widens to (1320px) and places the problem brief, expected outcomes, and result in the main column beside a sticky conversation panel. Plain sections and fine dividers establish the reading order. At (900px) and below, the columns stack and the conversation returns to normal document flow; its message history retains bounded scrolling. At (720px) and below, issue-list subjects and metadata span the full row above status and the navigation cue, and detail status follows the title on its own line.

Settings separates personal Appearance and common workspace controls from More settings. Sandbox tests belong with Execution environments, not the default Automation screen. The same neutral tokens and compact field treatment apply throughout; reducing information does not introduce a new visual style.

The workspace uses a two-column shell: expanded sidebar (232px), reduced to (212px) between (721px) and (1050px), beside a flexible main panel. The toolbar is (60px) tall. Desktop content padding is (30px 32px 48px), tablet inline padding is (24px), and mobile padding is (24px 16px 40px). The main panel owns workspace scrolling.

At (720px) and below, workspace navigation moves to a menu and shared controls and navigation rows use a minimum (44px) target. Desktop action controls use a minimum (36px); fields, search controls, and dropdown triggers use `field-height` (40px), increasing to (44px) on mobile. Multiline fields and composers may be taller. Cards use (20px) body padding, reduced to (16px) on mobile. Shared spacing follows the extracted four-pixel steps.

Public pages use centered content rails: landing navigation and preview (1264px), public marketing outer/content rails (1200px/1080px), and trust content (1160px). Public modules have their own responsive breakpoints and native menu behavior. The landing product illustration scrolls horizontally inside its frame on narrow screens; it is a demonstration, not the authenticated shell.

## Elevation & Depth

Cards, rails, ordinary action buttons, and selected rows are flat. Thin boundaries and changes of surface tone establish grouping. Fields, search controls, and dropdown triggers use the shallow `field-shadow`: `0 1px 2px rgba(28, 29, 31, 0.06), 0 2px 6px rgba(28, 29, 31, 0.04)` in light mode, with darker downward shadows in dark mode. The sidecar records both field shadow values alongside the stronger overlay and dialog shadows. Focused fields remove that shadow and use one existing border with a subtle gray fill: `field-focus-border` / `field-focus-surface` are #737780 / #f4f4f5 in light mode and #9699a0 / #2a2b2e in dark mode. Composite wrappers own this highlight; their inner inputs stay transparent and borderless. New CSS-module composites opt in with `data-field-shell`. Invalid fields retain their danger border; forced colors restore one system outline on the owning field. Other keyboard actions keep their visible outline.

**The Flat Surface Rule.** Keep cards, navigation, and ordinary action buttons flat. Use only the shared shallow downward shadow for fields, search controls, and dropdown triggers; reserve stronger elevation for overlays.

## Shapes

Small squared curves define structural controls: the `sm` radius for ordinary buttons and navigation; `md` for supporting surfaces; `lg` for cards and overlays; `xs` for badges. Standalone inputs, composite fields, search controls, and dropdown triggers share `field-radius` (12px). Pills remain appropriate for switch tracks and other existing rounded mechanisms. Borders are usually a single (1px) stroke. The logo is a flat typographic mark without bevels, glow, or a three-dimensional asset treatment.

## Components

- **Buttons:** compact, medium-weight controls. Primary actions use charcoal; secondary actions use a white surface with a control boundary. Danger and success variants retain semantic fills and text. Hover changes tone; enabled press states may move by (1px). Disabled controls use muted tokens and reduced opacity.
- **Fields:** rounded white controls in light mode, with a (12px) radius, a fine (1px) neutral border, shallow downward shadow, and (9px 12px) standalone padding. Search controls, `.search-action`, and select triggers share this treatment. Composite search, secret, and composer fields keep nested inputs transparent and borderless, with one outer boundary and compact icons. Hover strengthens the border without lift. Keyboard focus uses a (2px) outline; invalid fields use the danger border. Disabled fields use the disabled surface, muted text, and no shadow; a disabled send button alone does not disable its composer. Portaled organization forms and problem filter fields follow the same tokens. Forced colors remove field shadows and use system boundaries and focus colors.
- **Navigation:** readable labels stay expanded on desktop and tablet. Selected rows use the pressed surface and stronger text; hover changes tone without lift. Mobile menus preserve the same destinations.
- **Badges:** compact flat labels with neutral or semantic backgrounds. Use readable text to identify state; color supplements the label.
- **Cards and records:** single thin borders, separated headers, and plain content areas. Tables use muted headers and row separators; hover highlights a row without lifting it.
- **Issue conversation:** a flat bordered panel with a labeled header, scrollable history, and a separated composer or read-only notice. Team messages use a muted surface; CloseSpan replies stay on the panel surface, with explicit author labels. Discuss and Check scenario use compact pressed-state controls, with the requirement-check meaning visible beside the result. Send, mode, and suggestion controls use minimum (44px) touch targets on mobile and coarse pointers. New messages use a polite log; errors and saved-state notices remain visible in context. Demo conversation labels identify sample questions and responses.
- **Result decisions:** a fine divider and a question separate human feedback from recorded checks. This works and Needs changes sit together; requesting changes reveals a labeled feedback field. Confirmation, unavailable, and outdated-review text stays beside the controls. Coding and final approval actions have their own explicit labels and supporting consequence text, distinct from accepting the result.
- **Motion:** short state transitions use the shared durations and easing. Respect the existing reduced-motion and forced-colors rules. Public illustration arrival motion is local to that surface.
- **Gooey view switch:** the Issues List/Board control uses `liquid-gooey` for a bounded, 260ms moving selection highlight. Two decorative silhouettes merge with a 45ms trailing offset; text, icons, buttons, and focus outlines remain outside the filtered layer. The fill uses `surface-pressed` in both themes. The control renders a static selected state on the server and unmounts the liquid layer for reduced motion or forced colors. It retains 44px touch targets and adds no extra actions or automatic motion.
- **Shared Gooey feedback:** `GooeyInteractions` adds one short liquid response to buttons, navigation and action links, tabs, dropdown options, native switches, and appearance choices throughout the app, including portaled menus. It observes native pointer, focus, and change events without changing controls, handlers, layouts, or approval behavior. Text fields and inline links get only a bottom-edge response. The temporary decorative overlay uses a low-opacity foreground tint, never filters real content, never intercepts input, and disappears within 360ms. Only one shared response is mounted at a time; the dedicated view switch is excluded. Reduced motion, forced colors, disabled/inert controls, scrolling, and hidden pages suppress or cancel the effect. Static cards, content, and status badges do not animate.

## Do's and Don'ts

### Do:

- Do use the shared semantic CSS variables so light and dark preferences remain supported.
- Do retain visible labels, keyboard focus, and readable human-control states.
- Do use compact controls and thin boundaries, with larger workspace touch targets on mobile.
- Do preserve each surface's established layout and scroll ownership.

### Don't:

- Don't restore purple as default branding or raised neumorphic controls; a user-selected purple accent is a personal preference.
- Don't use shadows to separate ordinary cards or navigation rows, or add inset depth to fields.
- Don't turn the landing illustration's miniature labels into workspace typography.
- Don't replace explicit status labels with color alone.
