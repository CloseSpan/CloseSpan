# Pretext API Notes

Package: `@chenglou/pretext`

Official source: https://github.com/chenglou/pretext

## Main APIs

- `prepare(text, font, options?)`: segments and measures text for a CSS font shorthand.
- `layout(prepared, maxWidth, lineHeight)`: returns `{ lineCount, height }`.
- `prepareWithSegments(...)`: retains text segments for line materialization.
- `layoutWithLines(...)`: returns the laid-out lines in addition to count and height.
- `measureLineStats(...)`: returns line count and maximum line width.
- `measureNaturalWidth(...)`: returns the unwrapped width.
- `clearCache()`: clears Pretext measurement caches.

`PrepareOptions` supports `whiteSpace`, `wordBreak`, and numeric `letterSpacing`.

## Container-Aware Fit

For a bounded title:

1. Observe the content width.
2. Build the exact CSS font shorthand for a candidate font size.
3. Call `prepare` for that candidate.
4. Call `layout` with the available width and matching line height.
5. Binary-search between a readable minimum and the design-system maximum until `lineCount <= maxLines`.
6. Apply only the resulting `font-size` to the semantic DOM element.

For a strict single-line label, use `prepareWithSegments` with
`measureNaturalWidth` instead of relying on `layout(...).lineCount`. A wrapping
layout can report one line for text whose natural width still exceeds a
`white-space: nowrap` surface.

Make the observed semantic element block-level (or otherwise give it a defined
content width). `ResizeObserver` does not reliably report useful dimensions for
non-replaced inline text.

Cache preparation results when the same text/font candidates recur. A resize with an unchanged font can reuse prepared text and call only `layout`.

## Runtime Requirements

Pretext uses `Intl.Segmenter` and Canvas 2D. Invoke it in client-side effects, not during Next.js server rendering. Preserve CSS wrapping as the no-JavaScript fallback.
