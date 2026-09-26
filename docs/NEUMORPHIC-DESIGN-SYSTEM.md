# Neumorphic Design System

A reusable, product-neutral guide to CloseSpan's previous soft, sculpted interface. Use this file as a visual brief for another product, or copy the CSS starter into that product.

**Archive, not the current theme.** This guide does not override CloseSpan's active `DESIGN.md` or its Attio-inspired styling. Nothing here is imported by the app.

**Source:** the original `src/app/neumorphic-theme.css` at Git commit `dfd457669f8b319869bc3876cadcee739607cfd5`. The palette, depth recipes, type scale, and interaction model below come from that version. The namespaced component starter is a portable adaptation, not a byte-for-byte backup of every page or its behavior.

## 1. Visual identity

The interface should feel molded from one continuous surface. Cards and buttons rise gently out of the canvas; fields and selected items are pressed into it. A consistent light source comes from the upper left.

- **Light:** cool lavender-white canvas, slate text, violet actions.
- **Dark:** deep blue-charcoal canvas, pale slate text, lavender highlights, violet action fills.
- **Depth:** paired soft shadows—light at the upper left, dark at the lower right. Reverse the pair for recessed elements.
- **Shape:** generous rounded cards, pill-shaped actions and selectors, rounded inset fields.
- **Hierarchy:** short headings, readable labels, restrained status colors, and ample space between shadowed surfaces.
- **Brand independence:** bring the new product's own name, logo, content, and workflows. A 3D logo is not required to use this system.

## 2. Original palette

| Role | Light | Dark |
| --- | --- | --- |
| Canvas / base surface | `#f0f2f9` | `#151b27` |
| Hover surface | `#f5f6fb` | `#1a2230` |
| Pressed surface | `#e8ecf5` | `#111722` |
| Muted surface | `#e6ebf5` | `#202938` |
| Disabled surface | `#e5eaf3` | `#111722` |
| Strong text | `#263249` | `#f2f5fb` |
| Body text | `#3f4b63` | `#c9d2e3` |
| Secondary text | `#59667f` | `#9aa8bd` |
| Accent text / selected navigation | `#5146e5` | `#9a93ff` |
| Primary action fill | `#5146e5` | `#5146e5` |
| Primary hover fill | `#463bd1` | `#6157ed` |
| Primary pressed fill | `#3f35c3` | `#4439cc` |
| Text on primary | `#ffffff` | `#ffffff` |
| Success text | `#0b674d` | `#64d6ae` |
| Warning text | `#855214` | `#f1bd69` |
| Danger text | `#a92f40` | `#ff8798` |
| Informational text | `#386aa8` | `#79b5f3` |

Keep accent **text** separate from accent **fill**: pale lavender is readable on a dark background but is not the original dark-mode button fill. Prefer the same base color for the canvas and ordinary cards; the shadows create their separation.

## 3. Typography, spacing, and shape

- Preferred font stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Inter was the original declared preference; load or self-host it separately if the new product requires that exact face. Otherwise the system fallback applies.
- Body: `15px`, line height `1.55`. Compact labels: `13px`; secondary metadata: `12px`.
- Medium / semibold / bold weights: `550 / 650 / 760`. Variable Inter supports these; static fonts may choose the nearest available weight.
- Page heading: `clamp(1.75rem, 3vw, 2.5rem)`. Hero: `clamp(2.5rem, 6vw, 5rem)`. Heading line height: `1.15`.
- Spacing steps: `4, 8, 12, 16, 20, 24, 28, 32, 40, 48px`.
- Radius steps: `8, 10, 14, 20, 26px`, plus `999px` for pills. Use `20–26px` for large cards and `14px` for supporting containers; pill controls are a recurring presentation variant.
- Controls: at least `44px` high; larger actions `48px`. Do not shrink icon-only hit areas below the control height.
- Content maximum: `1440px`. Typical card padding: `24–32px`, reduced on small screens.

## 4. Material and interaction rules

| Element / state | Treatment |
| --- | --- |
| Card | Base surface + large paired outer shadow |
| Secondary button | Base surface + small paired outer shadow |
| Hovered action | Slightly brighter surface, stronger outer shadow, up to `-1px` vertical movement |
| Pressed action | Inset shadow; return movement to `0` |
| Primary action | Solid violet fill + inner edge highlights + surrounding paired shadows |
| Input / textarea | Recessed surface with inset shadows |
| Active navigation | Pressed surface + inset shadow + accent-colored label |
| Disabled control | Muted text + disabled surface + inset shadow; no lift and no hover response |
| Menu / dialog | Larger paired shadow; retain correct layering, focus management, and dismissal behavior |
| Divider | Subtle tonal separation; avoid heavy rectangular borders |

The original final theme used depth instead of decorative borders on ordinary surfaces. Do **not** copy its broad border-removal rules into another app: visible focus, invalid fields, tables that need separators, and forced-color mode still need clear boundaries.

State changes should normally take `120–180ms`, with larger transitions up to `280ms`, using `cubic-bezier(0.2, 0.8, 0.2, 1)`. Respect reduced-motion preferences.

## 5. Copy-paste CSS starter

This is a self-contained subset for cards, buttons, navigation, fields, status labels, and switches. Token names are prefixed to avoid conflicts. The original shadow values are preserved for the included roles; the explicit focus outline and compact component APIs are portability choices. The original also had accessibility and reduced-motion rules—those were not absent.

Place `.neu-theme` on your page root (usually `<body>`), with `data-theme="light"` or `data-theme="dark"` on **that same element**. This starter styles appearance only; connect actions, routing, menus, dialogs, and theme persistence through the new product's own application logic.

```css
.neu-theme {
  color-scheme: light;
  --neu-bg: #f0f2f9;
  --neu-surface: #f0f2f9;
  --neu-hover: #f5f6fb;
  --neu-pressed: #e8ecf5;
  --neu-muted-surface: #e6ebf5;
  --neu-disabled: #e5eaf3;
  --neu-text: #3f4b63;
  --neu-strong: #263249;
  --neu-muted: #59667f;
  --neu-accent: #5146e5;
  --neu-fill: #5146e5;
  --neu-fill-hover: #463bd1;
  --neu-fill-active: #3f35c3;
  --neu-on-fill: #ffffff;
  --neu-success: #0b674d;
  --neu-success-soft: rgba(22,130,98,.1);
  --neu-warning: #855214;
  --neu-warning-soft: rgba(150,98,27,.11);
  --neu-danger: #a92f40;
  --neu-danger-soft: rgba(169,47,64,.1);
  --neu-thumb: #ffffff;
  --neu-raised: -7px -7px 14px rgba(255,255,255,.92), 7px 7px 14px rgba(174,185,207,.34);
  --neu-raised-sm: -4px -4px 9px rgba(255,255,255,.88), 4px 4px 9px rgba(174,185,207,.25);
  --neu-raised-hover: -8px -8px 16px rgba(255,255,255,.96), 8px 8px 16px rgba(168,179,202,.37);
  --neu-inset: inset 5px 5px 10px rgba(174,185,207,.31), inset -5px -5px 10px rgba(255,255,255,.92);
  --neu-inset-sm: inset 3px 3px 7px rgba(174,185,207,.27), inset -3px -3px 7px rgba(255,255,255,.88);
  --neu-disabled-shadow: inset 3px 3px 7px rgba(174,185,207,.32), inset -3px -3px 7px rgba(255,255,255,.72);
  --neu-cta: inset 1px 1px 0 rgba(255,255,255,.22), inset -1px -1px 0 rgba(38,29,145,.28), -5px -5px 12px rgba(255,255,255,.86), 7px 7px 14px rgba(158,169,194,.33);
  --neu-cta-hover: inset 1px 1px 0 rgba(255,255,255,.26), inset -1px -1px 0 rgba(38,29,145,.32), -6px -6px 14px rgba(255,255,255,.92), 8px 8px 16px rgba(150,162,188,.38);
  --neu-cta-active: inset 5px 5px 10px rgba(37,28,137,.5), inset -4px -4px 9px rgba(142,135,255,.34);
  --neu-overlay: -12px -12px 24px rgba(255,255,255,.86), 12px 12px 28px rgba(160,172,196,.38);
  --neu-ease: cubic-bezier(.2,.8,.2,1);
  margin: 0;
  min-height: 100dvh;
  background: var(--neu-bg);
  color: var(--neu-text);
  font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.neu-theme[data-theme="dark"] {
  color-scheme: dark;
  --neu-bg: #151b27;
  --neu-surface: #151b27;
  --neu-hover: #1a2230;
  --neu-pressed: #111722;
  --neu-muted-surface: #202938;
  --neu-disabled: #111722;
  --neu-text: #c9d2e3;
  --neu-strong: #f2f5fb;
  --neu-muted: #9aa8bd;
  --neu-accent: #9a93ff;
  --neu-fill: #5146e5;
  --neu-fill-hover: #6157ed;
  --neu-fill-active: #4439cc;
  --neu-success: #64d6ae;
  --neu-success-soft: rgba(100,214,174,.12);
  --neu-warning: #f1bd69;
  --neu-warning-soft: rgba(241,189,105,.12);
  --neu-danger: #ff8798;
  --neu-danger-soft: rgba(255,135,152,.12);
  --neu-thumb: #dce3f0;
  --neu-raised: -7px -7px 14px rgba(49,60,81,.46), 7px 7px 14px rgba(3,7,14,.68);
  --neu-raised-sm: -4px -4px 9px rgba(49,60,81,.4), 4px 4px 9px rgba(3,7,14,.58);
  --neu-raised-hover: -8px -8px 16px rgba(54,66,89,.5), 8px 8px 16px rgba(2,6,13,.72);
  --neu-inset: inset 5px 5px 10px rgba(3,7,14,.64), inset -5px -5px 10px rgba(49,60,81,.42);
  --neu-inset-sm: inset 3px 3px 7px rgba(3,7,14,.58), inset -3px -3px 7px rgba(49,60,81,.36);
  --neu-disabled-shadow: inset 3px 3px 7px rgba(3,7,14,.72), inset -3px -3px 7px rgba(49,60,81,.25);
  --neu-cta: inset 1px 1px 0 rgba(255,255,255,.14), inset -1px -1px 0 rgba(22,16,91,.48), -5px -5px 12px rgba(49,60,81,.46), 7px 7px 14px rgba(2,6,13,.72);
  --neu-cta-hover: inset 1px 1px 0 rgba(255,255,255,.17), inset -1px -1px 0 rgba(22,16,91,.54), -6px -6px 14px rgba(54,66,89,.5), 8px 8px 16px rgba(2,6,13,.78);
  --neu-cta-active: inset 5px 5px 10px rgba(20,14,91,.72), inset -4px -4px 9px rgba(131,122,255,.28);
  --neu-overlay: -12px -12px 24px rgba(49,60,81,.42), 12px 12px 28px rgba(2,5,11,.76);
}
.neu-theme *, .neu-theme *::before, .neu-theme *::after { box-sizing: border-box; }
.neu-theme :is(h1,h2,h3) { color: var(--neu-strong); line-height: 1.15; }
.neu-theme h1 { font-size: clamp(1.75rem,3vw,2.5rem); font-weight: 760; }
.neu-theme h2 { font-size: 1.5rem; font-weight: 650; }
.neu-theme a { color: var(--neu-accent); }
.neu-page { width: min(100%,1440px); margin-inline: auto; padding: 32px; }
.neu-stack { display: grid; gap: 24px; }
.neu-row { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.neu-card { padding: 28px; border-radius: 20px; background: var(--neu-surface); box-shadow: var(--neu-raised); }
.neu-inset { padding: 20px; border-radius: 14px; background: var(--neu-pressed); box-shadow: var(--neu-inset-sm); }
.neu-secondary { color: var(--neu-muted); }
.neu-theme .neu-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 12px 20px; border: 0; border-radius: 999px;
  background: var(--neu-surface); color: var(--neu-strong); box-shadow: var(--neu-raised-sm);
  font: inherit; font-weight: 650; text-decoration: none; cursor: pointer;
  transition: background-color 180ms var(--neu-ease), box-shadow 180ms var(--neu-ease), transform 120ms var(--neu-ease);
}
.neu-theme .neu-button:hover:not(:disabled) { background: var(--neu-hover); box-shadow: var(--neu-raised-hover); transform: translateY(-1px); }
.neu-theme .neu-button:active:not(:disabled) { background: var(--neu-pressed); box-shadow: var(--neu-inset-sm); transform: translateY(0); }
.neu-theme .neu-button--primary { background: var(--neu-fill); color: var(--neu-on-fill); box-shadow: var(--neu-cta); }
.neu-theme .neu-button--primary:hover:not(:disabled) { background: var(--neu-fill-hover); color: var(--neu-on-fill); box-shadow: var(--neu-cta-hover); }
.neu-theme .neu-button--primary:active:not(:disabled) { background: var(--neu-fill-active); color: var(--neu-on-fill); box-shadow: var(--neu-cta-active); }
.neu-theme .neu-button:disabled { background: var(--neu-disabled); color: var(--neu-muted); box-shadow: var(--neu-disabled-shadow); transform: none; cursor: not-allowed; opacity: 1; }
.neu-field { display: grid; gap: 8px; font-weight: 650; }
.neu-input {
  width: 100%; min-width: 0; min-height: 44px; padding: 12px 16px;
  border: 0; border-radius: 14px; background: var(--neu-pressed); color: var(--neu-strong);
  box-shadow: var(--neu-inset-sm); font: inherit; font-weight: 400;
}
.neu-input::placeholder { color: var(--neu-muted); opacity: 1; }
.neu-input:disabled { background: var(--neu-disabled); color: var(--neu-muted); cursor: not-allowed; }
.neu-input[aria-invalid="true"] { outline: 2px solid var(--neu-danger); outline-offset: 2px; }
.neu-nav { display: grid; gap: 8px; }
.neu-theme .neu-nav a { display: flex; align-items: center; min-height: 44px; padding: 12px 16px; border-radius: 14px; color: var(--neu-text); text-decoration: none; }
.neu-theme .neu-nav a:hover { box-shadow: var(--neu-raised-sm); }
.neu-theme .neu-nav a[aria-current="page"] { background: var(--neu-pressed); color: var(--neu-accent); box-shadow: var(--neu-inset-sm); font-weight: 650; }
.neu-badge { display: inline-flex; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; }
.neu-badge--success { color: var(--neu-success); background: var(--neu-success-soft); }
.neu-badge--warning { color: var(--neu-warning); background: var(--neu-warning-soft); }
.neu-badge--danger { color: var(--neu-danger); background: var(--neu-danger-soft); }
.neu-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; }
.neu-switch {
  appearance: none; flex: 0 0 48px; width: 48px; height: 28px; margin: 0;
  border: 0; border-radius: 999px; padding: 4px; cursor: pointer;
  background: var(--neu-pressed); box-shadow: var(--neu-inset-sm);
}
.neu-switch::before { content: ""; display: block; width: 20px; height: 20px; border-radius: 50%; background: var(--neu-thumb); box-shadow: var(--neu-raised-sm); transition: transform 180ms var(--neu-ease); }
.neu-switch:checked { background: var(--neu-fill); box-shadow: var(--neu-cta-active); }
.neu-switch:checked::before { transform: translateX(20px); }
.neu-switch:disabled { cursor: not-allowed; opacity: .6; }
.neu-theme :is(a,button,input,textarea,select,summary):focus-visible { outline: 2px solid var(--neu-accent); outline-offset: 4px; }
@media (max-width:720px) {
  .neu-page { padding: 20px 16px; }
  .neu-card { padding: 20px; }
  .neu-row { gap: 12px; }
}
@media (prefers-reduced-motion:reduce) {
  .neu-theme *, .neu-theme *::before, .neu-theme *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
@media (forced-colors:active) {
  .neu-theme :is(.neu-card,.neu-inset,.neu-button,.neu-input,.neu-nav a,.neu-badge) { border: 1px solid CanvasText; box-shadow: none; }
  .neu-theme .neu-switch { appearance: auto; padding: 0; box-shadow: none; }
  .neu-theme .neu-switch::before { display: none; }
  .neu-theme :is(a,button,input,textarea,select,summary):focus-visible { outline: 2px solid Highlight; }
}
```

### Example markup

The buttons are intentionally inert examples. Add the new product's handlers before presenting them as working actions. Change `data-theme` on the root to preview dark mode; the attribute alone does not create a theme-switching control.

```html
<body class="neu-theme" data-theme="light">
  <main class="neu-page neu-stack">
    <h1>Workspace settings</h1>
    <section class="neu-card neu-stack" aria-labelledby="preferences-title">
      <div class="neu-row">
        <h2 id="preferences-title">Preferences</h2>
        <span class="neu-badge neu-badge--success">Connected</span>
      </div>
      <label class="neu-field" for="workspace-name">
        Workspace name
        <input class="neu-input" id="workspace-name" name="workspaceName" value="My workspace">
      </label>
      <label class="neu-switch-row">
        Email notifications
        <input class="neu-switch" type="checkbox" role="switch" checked>
      </label>
      <div class="neu-row">
        <button class="neu-button neu-button--primary" type="button">Save changes</button>
        <button class="neu-button" type="button">Cancel</button>
      </div>
    </section>
  </main>
</body>
```

## 6. Layout and accessibility guardrails

- Keep the desktop sidebar and toolbar stationary; scroll the content panel independently. A fixed-height shell needs `min-height: 0` on flexible children and `overflow-y: auto` on the content region. Keep keyboard-focused content visible. On phones, use an accessible menu rather than squeezing in the desktop sidebar.
- Let forms and buttons wrap. Avoid fixed content heights that clip labels, validation errors, translated text, or 200% zoom.
- Use depth to reinforce state, never as the only indication of a control. Keep visible labels, native button semantics, a meaningful selected state, and status text.
- Keep readable secondary text. Check final foreground/background combinations in both modes; changing an accent or applying opacity can break contrast even when the starting palette works.
- Maintain visible keyboard focus. The portable starter uses an explicit outline; the original frequently combined an inset surface with an accent focus ring.
- Keep a minimum `44px` interaction target. The switch's entire associated label row is the target; its visible track may be smaller.
- Use actual `disabled` on buttons/inputs. The starter's disabled styles do not implement disabled anchors or permission checks.
- Dialogs still need a name, focus trapping, Escape handling, and focus restoration. CSS shadows do not provide those behaviors.
- Support forced colors and reduced motion. Do not globally remove outlines or all borders with `!important`.
- Avoid stacking multiple raised cards inside raised cards. Use one outer raised surface and simpler inset groups inside.
- Do not reproduce the old flat gray “Back to workspace” button bug: secondary actions must use theme surface and text tokens in every state.

## 7. Reuse prompt for another product

Copy this prompt and attach this Markdown file:

> Use the attached Neumorphic Design System as the visual authority for this product. Preserve this product's functionality, content, accessibility, and brand name. Use the guide's lavender-white light palette, deep blue-charcoal dark palette, violet action fills, paired upper-left highlight/lower-right shadow, recessed inputs, selected navigation, and generous rounded surfaces. Build a shared token layer and reusable components rather than isolated CSS patches. Keep primary text/fill roles distinct, use 44px interaction targets, preserve keyboard focus, and support reduced motion and forced colors. Keep labels concise, the sidebar stable, and content scrolling independent. Do not import CloseSpan-specific business logic or logos. Adapt the included starter to the framework already in the project, wire actual interactions, and verify desktop/mobile and light/dark states. Ask before replacing an existing product design system; after approval, record the adopted rules in that product's own DESIGN.md.

## 8. What this archive includes—and does not

Included: reusable visual principles, exact selected original tokens, light/dark shadow recipes, component state rules, copy-paste starter CSS and HTML, and an implementation prompt.

Not included: the old site's full source tree, routing, authentication, business rules, icons, licensed font files, or a promise that untested new compositions are accessible. The starter is intentionally smaller than the legacy stylesheet. Use the recorded Git commit only if you need to inspect the complete historical implementation in the CloseSpan repository.
