---
name: pretext-text-fit
description: Integrate and use @chenglou/pretext to measure responsive text, prevent dynamic UI labels or titles from clipping, and build accessible container-aware text fitting. Use when bounded card titles, table rows, dashboard labels, buttons, badges, or responsive headings need reliable line-count or font-size fitting without DOM text measurement.
---

# Pretext Text Fit

Use Pretext for bounded dynamic text whose available width changes. Keep ordinary paragraphs on natural CSS wrapping.

## Workflow

1. Inspect the container at desktop, tablet, and mobile widths. Fix broken grid, flex, width, or gap rules before shrinking text.
2. Prefer CSS for known copy: `min-width: 0`, sensible grid tracks, `overflow-wrap`, and explicit metadata columns.
3. Use Pretext only when dynamic text must fit a defined line count or bounded surface.
4. Keep the real text in semantic HTML. Pretext measures; it must not replace accessible DOM content with canvas text.
5. Match the rendered metrics exactly: font family, weight, style, letter spacing, and line height.
6. Memoize `prepare` work by text and font. On resize, rerun the cheaper `layout` step. If font size must change, binary-search a bounded size range.
7. Observe the container with `ResizeObserver`; do not poll or measure every render.
8. Preserve a readable minimum font size. If the copy still cannot fit, allow wrapping or change the layout instead of making it illegible.
9. Verify loading fonts, zoom, long words, localization, reduced-motion mode, and narrow breakpoints.

## Project Pattern

Use the shared `FitText` component for dynamic bounded titles. Supply a two-line maximum for table and card titles, and a one-line maximum only when the surrounding control cannot grow.

Do not apply fitting to body copy, helper text, legal text, error explanations, or content users need to scan at a consistent size.

## Guardrails

- Use a named font when possible; platform aliases can measure differently across systems.
- Run Pretext in the browser because it depends on Canvas 2D and `Intl.Segmenter`.
- Provide a normal CSS-rendered initial state so server rendering remains legible.
- Treat text fitting as progressive enhancement; a missing `ResizeObserver` or canvas must not hide content.
- Never solve title/metadata collisions by concatenating fields into one inline string. Separate semantic fields into columns, rows, or tabs first.

For package APIs and implementation notes, read [references/pretext-api.md](references/pretext-api.md).
