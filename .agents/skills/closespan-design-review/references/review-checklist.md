# CloseSpan design review checklist

## Route coverage

Inspect representative pages from each available group:

- Public: landing, product/how-it-works content, connectors, resources, pricing, requests, trust/legal, login, waitlist, and contact.
- Core product: overview, feedback inbox, product problems, prioritization, investigations, approvals, follow-up, integrations, customers, and settings.
- Detail workflows: problem detail, engineering ticket and prompt checker, approval detail, agent run, connector setup, and dialogs/drawers.

Record redirects, authentication blocks, missing data, and unavailable states rather than silently skipping them.

## Visual system

- Typography hierarchy, line length, wrapping, and truncation
- Spacing rhythm, alignment, grid consistency, and density
- Color and contrast across light, dark, and translucent surfaces
- Glass blur, opacity, borders, shadows, overlapping layers, and browser fallbacks
- Icon size, stroke, meaning, and alignment
- Shared component consistency and token usage
- Charts, tables, empty states, and content-heavy layouts

## Interaction and accessibility

- Current-location indication in global and local navigation
- Keyboard reachability, logical focus order, and visible focus styles
- Semantic controls, labels, names, descriptions, and error association
- Hover, pressed, selected, disabled, loading, success, and failure states
- Dialog focus behavior, dismissal, backdrop, stacking, and scroll lock
- Minimum target sizes and mobile menu behavior
- Reduced motion and reduced transparency support
- Destructive actions, confirmation, and recovery cues

## Responsive checks

Use at least one desktop and one narrow viewport. Check:

- Horizontal overflow and clipped content
- Sidebar/topbar transformation and navigation reachability
- Tables, charts, tabs, filter bars, and action groups
- Dialog and drawer fit with the on-screen keyboard in mind
- Long workspace names, labels, customer names, and numbers
- Sticky elements and content hidden beneath fixed controls

## Evidence rules

- Cite the exact route, state, and viewport.
- Use screenshots for visual findings and DOM inspection for semantics.
- Verify suspected problems before reporting them.
- Distinguish observation, inference, and recommendation.
- Keep screenshots free of credentials and sensitive customer data.
