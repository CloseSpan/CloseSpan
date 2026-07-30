# CloseSpan UI Style Guide

This document is the durable visual and interaction standard for CloseSpan. Use it whenever a page, feature, component, state, or piece of customer-facing copy is created or changed.

The goal is one coherent product: modern, restrained, soft-neumorphic, accessible, responsive, and unmistakably CloseSpan.

## 1. Authority and source of truth

Use these sources in this order:

1. This guide defines design intent, component rules, responsive behavior, and review expectations.
2. [`src/app/neumorphic-theme.css`](src/app/neumorphic-theme.css) is the executable source of truth for tokens and shared component styling.
3. [`src/app/globals.css`](src/app/globals.css) contains structural and feature-specific layout rules. Do not add isolated colors, shadows, or component themes there when a shared token or variant can be used.
4. Reusable components such as [`CustomSelect`](src/components/custom-select.tsx), [`ThemeToggle`](src/components/theme-toggle.tsx), [`CloseSpanLogo`](src/components/closespan-logo.tsx), and [`WorkspaceRouteTransition`](src/components/workspace-route-transition.tsx) are preferred over local recreations.

When the implementation and this guide disagree, fix both in the same change. Do not allow the documentation and product to drift.

### 1.1 Brand asset placement

CloseSpan has two complementary logo systems. Choose by context rather than substituting one asset everywhere:

- Use [`CloseSpan3DLogo`](src/components/closespan-3d-logo.tsx) for public marketing headers and footers, login and waitlist identity, public feature requests, and branded public error states. It automatically swaps between the light and dark 3D lockups without layout shift.
- Use [`CloseSpanLogo`](src/components/closespan-logo.tsx) for the product sidebar, compact app shell, data previews, dense controls, and other small in-product placements where the raster depth would lose clarity.
- Use the square `</>` mark for browser favicons, PWA icons, bookmarks, and device home-screen icons. The active files are `favicon.ico`, `favicon-48.png`, `favicon-192.png`, `favicon-512.png`, and `apple-touch-icon.png` in `public/`.
- Keep `closespan-3d-logo-light-lockup-v1.png`, `closespan-3d-logo-dark-lockup-v1.png`, and the versioned `closespan-tab-logo-*-v1.png` files as the authored source assets.
- Never stretch, recolor, filter, outline, glow, or place the 3D lockup inside another raised button or card. Preserve its aspect ratio and let the supplied asset provide its own depth.

## 2. Design principles

### 2.1 One surface family

The canvas and components use the same soft blue-gray surface family. Hierarchy comes from light, shadow, spacing, scale, and typography, not a stack of unrelated background colors.

### 2.2 Depth communicates state

- Raised elements use a soft top-left highlight and a darker bottom-right shadow.
- Hovered elements become slightly more raised.
- Selected, pressed, and active elements use inset shadows.
- Inputs and wells normally appear inset.
- Overlays use the strongest approved elevation, but remain visually restrained.

### 2.3 No decorative borders

Ordinary cards, buttons, inputs, tabs, dropdowns, and navigation items should not depend on a visible outline. Use surface and shadow tokens instead. A subtle divider or semantic boundary is allowed when it materially improves comprehension, such as table rows, grouped sections, or error states.

### 2.4 Purple is purposeful

Purple is reserved for:

- Primary actions
- Selection and active state
- Keyboard focus
- Important product status
- Logo syntax
- Small editorial accents

Do not fill large areas with purple or add decorative purple glows.

### 2.5 Neumorphism must remain usable

Never trade legibility, keyboard focus, or clear interaction state for visual softness. Text must remain readable in both themes. Interactive targets must remain easy to identify and at least 44 by 44 pixels.

### 2.6 Restraint over effects

Avoid:

- Glassmorphism
- Bright white hover halos in dark mode
- Heavy gradients
- Glowing cards
- Cartoonish or very deep shadows
- Flat outlined controls mixed into the neumorphic system
- One-off visual treatments that do not exist elsewhere

## 3. Core tokens

Always use CSS variables. Do not copy raw color or shadow values into a component unless the value is genuinely unique and has been approved as a new token.

### 3.1 Light theme

```css
:root {
  --bg: #e9eef7;
  --surface: #e9eef7;
  --surface-hover: #edf2fa;
  --surface-pressed: #e4eaf4;
  --surface-muted: #e3e9f3;

  --text: #3f4b63;
  --text-strong: #263249;
  --text-muted: #59667f;
  --text-on-accent: #ffffff;

  --accent: #5146e5;
  --accent-hover: #463bd1;
  --accent-active: #3f35c3;
  --accent-soft: rgba(81, 70, 229, 0.1);
  --accent-line: rgba(81, 70, 229, 0.28);
}
```

### 3.2 Dark theme

```css
:root[data-theme="dark"] {
  --bg: #151b27;
  --surface: #151b27;
  --surface-hover: #1a2230;
  --surface-pressed: #111722;
  --surface-muted: #202938;

  --text: #c9d2e3;
  --text-strong: #f2f5fb;
  --text-muted: #9aa8bd;
  --text-on-accent: #ffffff;

  --accent: #9a93ff;
  --accent-hover: #aaa5ff;
  --accent-active: #837bfa;
  --accent-soft: rgba(154, 147, 255, 0.14);
  --accent-line: rgba(154, 147, 255, 0.38);
}
```

Dark mode must redefine the full token system. Do not invert the page with a filter and do not reuse light-theme white shadow values.

### 3.3 Semantic colors

Use the existing semantic token families:

- `--success`, `--success-soft`, and success fill states
- `--warning`, `--warning-soft`, and warning fill states
- `--danger`, `--danger-soft`, and danger fill states
- `--info` and `--info-soft`

Status cannot rely on color alone. Pair it with an icon, label, or both.

### 3.4 Shadows

```css
--shadow-raised:
  -7px -7px 14px rgba(255, 255, 255, 0.82),
   7px  7px 14px rgba(154, 169, 194, 0.38);

--shadow-inset:
  inset 5px 5px 10px rgba(154, 169, 194, 0.34),
  inset -5px -5px 10px rgba(255, 255, 255, 0.82);
```

Available roles include:

- `--shadow-raised` for cards and standard controls
- `--shadow-raised-sm` for compact controls
- `--shadow-hover` for hover elevation
- `--shadow-inset` and `--shadow-inset-sm` for pressed or selected state
- `--shadow-overlay` for modals, drawers, and menus
- `--shadow-focus` for keyboard focus
- `--shadow-accent-*` for purple primary actions
- `--shadow-color-*` for non-purple semantic actions
- `--shadow-progress-track` and `--shadow-progress-fill` for progress indicators
- `--shadow-sidebar` and `--shadow-topbar` for the persistent shell

Do not write a white shadow directly. Dark mode must use the dark token definitions so hover states never produce a white glow.

### 3.5 Radius

| Token | Value | Typical use |
| --- | ---: | --- |
| `--radius-xs` | 8px | Dense indicators |
| `--radius-sm` | 10px | Compact controls |
| `--radius-md` | 14px | Inputs and standard controls |
| `--radius-lg` | 20px | Cards and panels |
| `--radius-xl` | 26px | Large feature panels and overlays |
| `--radius-pill` | 999px | Pills, switches, and badges |

Use a pill only when the shape has meaning, such as a status badge, segmented control, filter, or switch. Do not make every control a pill.

### 3.6 Spacing

The spacing scale is based on 4 pixels:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-7: 28px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
```

Use the scale for margins, padding, gaps, and layout rhythm. Avoid arbitrary values unless a precise optical adjustment is required.

### 3.7 Typography

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

--text-xs: 0.75rem;
--text-sm: 0.8125rem;
--text-md: 0.9375rem;
--text-lg: 1.125rem;
--text-xl: 1.5rem;
--text-2xl: clamp(1.75rem, 3vw, 2.5rem);
--text-hero: clamp(2.5rem, 6vw, 5rem);

--weight-medium: 550;
--weight-semibold: 650;
--weight-bold: 760;
--leading-tight: 1.15;
--leading-body: 1.55;
```

Typography rules:

- Page titles use `--text-strong`, tight leading, and a clear weight contrast.
- Body copy uses `--text`.
- Supporting copy uses `--text-muted`, but must still meet readable contrast.
- Eyebrows use accent color, uppercase text, restrained tracking, and a short phrase.
- Avoid excessive all-caps text.
- Prevent orphaned headings and awkward single-word wraps when layout permits.

### 3.8 Controls and motion

```css
--control-height: 44px;
--control-height-lg: 48px;
--duration-fast: 120ms;
--duration-normal: 180ms;
--duration-slow: 280ms;
--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
```

Controls must be at least 44 pixels tall or provide an equivalent 44 by 44 pixel hit area.

## 4. Theme behavior

- Theme selection is stored under `closespan-theme`.
- Use `ThemeToggle` for the sun and moon switch. Do not build a second theme control.
- The theme switch belongs in the user or account menu where possible.
- All foreground, background, border, shadow, chart, scrollbar, and state colors must come from tokens.
- Text that is dark in light mode must become light in dark mode through tokens.
- Hover and focus states must be checked in both themes.
- Theme changes may animate with the standard duration, except when reduced motion is requested.

## 5. Brand and voice

### 5.1 Logo

Use `CloseSpanLogo` instead of reconstructing the logo with text.

- Lockup: `</CloseSpan>`
- Mark: `</>`
- Syntax characters use the purple accent.
- `CloseSpan` is dark in light mode and light in dark mode.
- `Span` has the stronger weight.
- The landing-page lockup may use the approved embossed text treatment, but it must remain legible and must not become a button or badge.
- Use the provided `xs`, `sm`, `md`, and `lg` sizes.
- Set `decorative={false}` only when the logo is the meaningful accessible label.

### 5.2 Product language

- Use **customer voice** in top-level marketing language when describing the broader product value.
- Use **feedback** when referring to a precise product object, inbox record, imported ticket, or established feature name.
- Prefer concrete operational language: evidence, impact, approval, owner, release, verification, follow-up.
- Avoid inflated AI claims and generic phrases that make the product sound templated.
- Do not use em dashes in customer-facing copy. Use a period, colon, comma, or parentheses.
- Keep the first screen concise. Lead with the outcome and move supporting detail lower in the page.

## 6. Layout and alignment

### 6.1 General alignment contract

- Every page needs a visible alignment rail.
- Page heading, primary content, major panels, and footer should share intentional left and right edges.
- Internal panels align to one content gutter instead of inventing their own offsets.
- Card grids use equal columns and consistent gaps.
- Equal-purpose cards use equal heights. Actions and footers align to the bottom.
- Center text only when the component is intentionally centered. Default product UI is left aligned.
- Use `min-width: 0` on grid and flex children that may contain long text.

### 6.2 Landing-page rails

The landing page uses:

```css
--landing-outer-rail: 1184px;
--landing-panel-rail: 1128px;
--landing-inline-gutter: 28px;
```

- The FAQ grid, signal panel, workflow panel, CTA, and footer align to these rails.
- On mobile, major panels use `width: calc(100% - 32px)`.
- Desktop footer padding is 28 pixels. Mobile footer padding is 16 pixels.

### 6.3 Public marketing rails

Public marketing pages use:

```css
--public-outer-rail: 1180px;
--public-content-rail: 1060px;
```

- Header and hero use the outer rail.
- Body content, steps, related content, CTA, and footer use the content rail.

### 6.4 Persistent product shell

- Keep the sidebar and top bar stable during product navigation.
- Only the route content stage should transition.
- Sidebar items follow the order in `WORKSPACE_NAVIGATION`.
- Forward navigation enters from below. Backward navigation enters from above.
- Route motion is subtle: 18 pixels, 200 milliseconds, with reduced-motion support.

## 7. Component standards

### 7.1 Buttons

Every button requires default, hover, pressed, focus, disabled, and loading states.

Secondary button:

- Surface background
- Raised shadow
- Strong text
- Hover shadow on pointer hover
- Inset shadow when pressed

Primary button:

- `--accent-fill` background
- `--text-on-accent` text
- Accent neumorphic shadow, not a flat purple rectangle
- Accent hover and inset states

Semantic buttons use the matching success, warning, or danger token families with `--shadow-color-*`.

Button shape and height must stay consistent when two actions appear together. Icons and text align on one line. Labels should not wrap unless the layout explicitly supports a multiline action.

### 7.2 Icon buttons

- Minimum 44 by 44 pixel hit area
- Icon centered optically and geometrically
- Accessible label required
- Raised by default, inset when selected or pressed
- Tooltips should clarify unfamiliar actions, not duplicate visible labels

### 7.3 Cards and panels

- Use the shared surface and an approved raised shadow.
- Avoid visible decorative borders.
- Use `--radius-lg` for ordinary cards and `--radius-xl` for large editorial panels.
- Preserve equal height and aligned footers in grids.
- Hover only when the whole card is interactive.
- Never introduce a bright hover halo in dark mode.
- Avoid a raised button placed inside an already button-shaped raised container.

### 7.4 Tabs, filters, and segmented controls

- Keep height and padding compact.
- Inactive items are subtly raised.
- Active items are pressed with an inset shadow and accent text.
- Use one standardized count badge style.
- Remove visible white outlines.
- Provide at least 44 pixels of hit area.
- On narrow screens, scroll horizontally without clipping labels.
- Add a subtle edge fade or equivalent cue when more items are available off-screen.
- A view switch such as Board and Ranked is a segmented control: one shared track, one clearly pressed selection.

### 7.5 Inputs and textareas

- Use an inset surface with no decorative border.
- Use `--text` for entered text and a readable muted token for placeholder text.
- Focus uses the accent outline and `--shadow-focus`.
- Error and success state add semantic color, icon, and message without removing the base focus treatment.
- Labels sit outside the field and remain visible after input.
- Help and validation text align to the field edge.

### 7.6 Dropdowns and selects

Use `CustomSelect` for product UI. Do not introduce native `<select>` styling or a new dropdown implementation without a functional reason.

The shared select supports:

- Accessible trigger labeling
- Listbox semantics
- Arrow, Home, End, Enter, Space, Escape, and Tab behavior
- Outside-click dismissal
- Selected and highlighted states
- Optional leading icon and hidden form value

Visual rules:

- Trigger is raised at rest and inset when open.
- Menu uses the overlay surface and `--shadow-overlay`.
- No visible border around the trigger or menu.
- Selected option uses a check and accent treatment.
- Menu remains within the viewport and supports long labels without clipping.

### 7.7 Checkboxes and radio buttons

- Use a neumorphic surface, not the browser default box.
- Resting control is inset or softly raised according to context.
- Checked state uses accent fill or accent icon plus inset depth.
- Keyboard focus remains obvious.
- The label is part of the hit target.
- Never communicate checked state with color alone.

### 7.8 Switches

- Use a pill-shaped inset track and raised thumb.
- The thumb position, icon, and accessible state communicate the current value.
- Theme switch uses sun and moon icons.
- Include `role="switch"` and `aria-checked` when a native checkbox is not used.

### 7.9 Progress bars

- Track uses `--shadow-progress-track`.
- Fill uses the accent token and `--shadow-progress-fill`.
- Rounded ends must remain consistent at all values.
- Include a text value or accessible value attributes.
- Do not use a flat gray track with a flat purple line.

### 7.10 Badges, counters, and status

- Use compact padding and a pill radius.
- Counts have one standardized size and alignment.
- Status color comes from semantic tokens.
- Use text labels that are understandable without color.
- Do not allow a badge to change row height unexpectedly.

### 7.11 Navigation and sidebar

- Sidebar hover uses a raised neumorphic state, never a visible border.
- Active navigation uses an inset state and legible accent treatment.
- Icons, labels, and badges align to a common baseline.
- Text must remain readable in dark mode during default, hover, active, and focus states.
- Native browser title tooltips should not appear as a substitute for designed navigation labels.

### 7.12 Tables and lists

- Use consistent column alignment and stable widths for status and action columns.
- Vertically center cells with comparable content.
- Keep row height consistent.
- Use tokenized row hover, never a white flash in dark mode.
- `View details` actions use the same single-line or centered compact control in every row.
- Long values wrap or truncate intentionally and expose the full value when needed.
- On narrow screens, use controlled horizontal scrolling or a designed card transformation.

### 7.13 Charts

- Use `--chart-grid` for grid lines.
- Labels use readable text tokens in both themes.
- Low-volume data remains visible without falsifying values.
- Hover and focus provide the same details.
- Empty and awaiting-analysis states explain the next step.
- Source filters use `CustomSelect`.

### 7.14 Modals and drawers

- Use the overlay backdrop token and overlay shadow.
- Maintain a clear title, concise explanation, primary action, secondary action, and close control.
- Trap focus, restore focus on close, and support Escape.
- Keep controls within the viewport on small screens.
- Use a drawer before connecting an integration to explain permissions and imported data.
- Avoid nested raised containers that look like buttons placed on buttons.

### 7.15 FAQ accordions

- Two equal columns on desktop, one column on mobile.
- Closed rows align question text and the 28-pixel icon column.
- Expanded content maintains the same internal gutter.
- Question text uses `--text-strong` in both themes.
- The plus or minus control has a clear raised or pressed state.

### 7.16 Empty, loading, success, and error states

- Empty state names what is missing and offers one clear next action.
- Loading state preserves layout to avoid content shift.
- Skeletons use the theme sheen token.
- Success state confirms what happened and where the user can go next.
- Error state uses plain language, hides raw provider or schema errors, and offers recovery.
- Disabled state remains readable but visibly unavailable.
- No state should trap the user without another useful path.

## 8. Responsive behavior

Test at minimum:

- 1440 pixels and wider desktop
- 1024 pixel laptop or tablet landscape
- 768 pixel tablet
- 390 pixel phone
- 320 pixel minimum width

Rules:

- Never allow horizontal page overflow.
- Do not clip navigation, tabs, labels, dropdown menus, or actions.
- Stack card grids predictably while preserving reading order.
- CTA sections switch from two columns to one column below 1050 pixels.
- Mobile CTA buttons become full width.
- Major panels keep 16-pixel viewport gutters on mobile.
- Drawers may become full width, but must retain a visible close action.
- Sticky elements must not obscure content.
- Avoid fixed heights for content that can wrap.

## 9. Accessibility

- Normal text meets WCAG AA contrast.
- Large text and icons remain legible in both themes.
- Focus uses `outline: 2px solid var(--accent)`, a 3-pixel offset, and `--shadow-focus`.
- Use semantic HTML first.
- Every icon-only action needs an accessible name.
- Every input needs a visible label.
- Every error is associated with the affected field.
- Hover-only information must also be available by keyboard focus or click.
- Dialog focus is trapped and restored.
- Interactive targets are at least 44 by 44 pixels.
- Respect `prefers-reduced-motion`.
- Do not use color as the only indicator of selection, status, validation, or chart meaning.

## 10. Motion and interaction

- Use motion to explain state or navigation, not to decorate the screen.
- Standard transitions use `--duration-fast` or `--duration-normal`.
- Large panel transitions may use `--duration-slow`.
- Hover elevation is small and should not noticeably move surrounding layout.
- Pressed state uses inset shadow and, at most, a subtle one-pixel translation.
- Product route transitions preserve the shell and move only the content stage.
- Disable nonessential motion when reduced motion is requested.

## 11. Implementation recipe for new UI

Before writing styles:

1. Identify the closest existing component and reuse it if possible.
2. Choose tokens for surface, text, spacing, radius, shadow, motion, and status.
3. Define default, hover, pressed, focus, disabled, loading, success, and error behavior.
4. Define both light and dark behavior through tokens.
5. Place the component on the correct page alignment rail.
6. Decide how it wraps, stacks, or scrolls at 1024, 768, 390, and 320 pixels.
7. Add semantic HTML and keyboard behavior before visual polish.

Preferred component pattern:

```css
.new-control {
  min-height: var(--control-height);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-strong);
  box-shadow: var(--shadow-raised-sm);
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-normal) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.new-control:hover {
  background: var(--surface-hover);
  box-shadow: var(--shadow-hover);
}

.new-control:active,
.new-control[aria-pressed="true"],
.new-control[aria-selected="true"] {
  background: var(--surface-pressed);
  color: var(--accent);
  box-shadow: var(--shadow-inset-sm);
}

.new-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  box-shadow: var(--shadow-focus);
}
```

Do not add `border: 1px solid white`, raw white shadows, or a hard-coded dark theme override.

## 12. Review checklist

### Visual consistency

- [ ] Uses shared tokens instead of isolated values
- [ ] Matches the soft blue-gray surface family
- [ ] Uses raised, hover, and inset depth correctly
- [ ] Contains no unnecessary border, glass, glow, or heavy gradient
- [ ] Uses purple only for purposeful emphasis
- [ ] Typography and spacing match the shared scale
- [ ] Icons use the existing icon language and consistent sizing

### Alignment and responsive behavior

- [ ] Page and panel edges follow the correct rail
- [ ] Repeated cards have equal heights and aligned actions
- [ ] Text, icons, badges, and controls share intentional baselines
- [ ] No label, tab, dropdown, table, or button is clipped
- [ ] No horizontal page overflow at 320 pixels
- [ ] Desktop, tablet, and mobile layouts have been inspected

### Interaction states

- [ ] Default, hover, pressed, focus, disabled, loading, success, and error states are present
- [ ] Hover styling works in light and dark themes
- [ ] Active state is more than a color change
- [ ] Keyboard interaction matches pointer interaction
- [ ] Reduced motion is respected

### Accessibility

- [ ] Text contrast is readable in both themes
- [ ] Focus is clearly visible
- [ ] Icon-only actions have accessible names
- [ ] Form labels and validation are associated correctly
- [ ] Status is not communicated by color alone
- [ ] Targets are at least 44 by 44 pixels

### Content

- [ ] The outcome appears before implementation detail
- [ ] Copy is concise and operational
- [ ] Top-level positioning uses customer voice where appropriate
- [ ] No raw technical provider errors are shown
- [ ] No em dashes appear in customer-facing copy
- [ ] Empty and error states provide a next step

## 13. Definition of done

A UI change is complete only when:

1. It uses the shared design tokens and reusable components.
2. It is visually coherent in light and dark themes.
3. Every interaction state is implemented.
4. It is keyboard accessible and respects reduced motion.
5. It has been inspected at desktop, tablet, and mobile widths.
6. No text, controls, menus, or content are clipped or misaligned.
7. Linting, type checks, tests, and the production build pass when available.
8. This guide is updated if the change introduces an approved new pattern.

## 14. Maintenance rule

When a new recurring pattern is approved:

1. Add or update a token in `src/app/neumorphic-theme.css`.
2. Build or update a reusable component variant.
3. Replace duplicate local styles where practical.
4. Document the pattern here.
5. Add visual and interaction coverage to the relevant review flow.

One-off styling should be treated as design debt. New features should make the system more coherent, not create another visual dialect.
