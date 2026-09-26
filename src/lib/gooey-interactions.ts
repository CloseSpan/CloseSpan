/** One short, decorative response for any native control, including portals. */
export const GOOEY_STATIC_QUERY = "(prefers-reduced-motion: reduce), (forced-colors: active)";
export const GOOEY_DURATION = 360;

const controls = 'button, a[href], summary, input, textarea, select, [role="button"], [role="tab"], [role="switch"], [role="option"], [role="menuitem"], [role="radio"], [role="checkbox"], [data-gooey-control]';
const excluded = '[inert], [hidden], [aria-disabled="true"], [data-gooey="off"], [data-gooey-view-switch], [data-gooey-overlay], [data-gooey-interaction], nextjs-portal, [contenteditable="true"]';
const fieldShells = '[data-field-shell], .searchbox, .secret-input, .delphi-composer, .integration-copilot-composer, .prompt-testing-composer, .feedback-reply-composer';

export type GooeyTarget = { control: HTMLElement; surface: HTMLElement; field: boolean };
export type GooeyFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
  color: string;
  field: boolean;
};

export function getGooeyTarget(target: EventTarget | null): GooeyTarget | null {
  if (!(target instanceof Element) || target.closest(excluded)) return null;
  let control = target.closest<HTMLElement>(controls);
  // Native radio/checkbox labels can contain previews and other non-control DOM.
  if (!control) {
    const label = target.closest<HTMLLabelElement>('label');
    const input = label?.control;
    if (input instanceof HTMLInputElement && ['radio', 'checkbox'].includes(input.type)) control = input;
  }
  if (!control || control.closest(excluded) || control.matches(':disabled, [type="hidden"]')) return null;

  const input = control instanceof HTMLInputElement ? control : null;
  const choice = input && ['radio', 'checkbox'].includes(input.type);
  const field = control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement ||
    (input !== null && !['radio', 'checkbox', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file'].includes(input.type));
  // Keep a checkbox's own visible track; hidden native radios use their label.
  const bounds = control.getBoundingClientRect();
  const choiceStyle = choice ? window.getComputedStyle(control) : null;
  const hiddenChoice = choice && (bounds.width < 8 || bounds.height < 8 ||
    (choiceStyle?.clipPath && choiceStyle.clipPath !== 'none') || choiceStyle?.opacity === '0');
  const surface = (hiddenChoice ? control.closest('label') : field ? control.closest(fieldShells) : null) ?? control;
  if (!(surface instanceof HTMLElement)) return null;
  return { control, surface, field };
}

export function getGooeyFrame(target: GooeyTarget): GooeyFrame | null {
  const { control, surface, field } = target;
  if (!surface.isConnected || control.matches(':disabled') || control.closest(excluded)) return null;
  const rect = surface.getBoundingClientRect();
  // Bound the filter to a control, never a whole panel or viewport.
  if (rect.width < 8 || rect.height < 8 || rect.width > 1800 || rect.height > 320 ||
    rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return null;
  const style = window.getComputedStyle(surface);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  // Inline prose links get a small underline response rather than a text wash.
  const underline = field || style.display === 'inline';
  let left = Math.max(0, rect.left + 1);
  let top = Math.max(0, underline ? rect.bottom - 4 : rect.top + 1);
  let right = Math.min(window.innerWidth, rect.right - 1);
  let bottom = Math.min(window.innerHeight, rect.bottom - 1);
  // A body portal must inherit the clipping of scrollable menus and sidebars.
  for (let parent = surface.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const clipping = window.getComputedStyle(parent);
    const clipX = /^(auto|scroll|hidden|clip)$/.test(clipping.overflowX);
    const clipY = /^(auto|scroll|hidden|clip)$/.test(clipping.overflowY);
    if (!clipX && !clipY) continue;
    const box = parent.getBoundingClientRect();
    if (clipX) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
    if (clipY) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
  }
  if (right <= left || bottom <= top) return null;
  return {
    left, top, width: right - left, height: bottom - top,
    radius: underline ? '2px' : style.borderRadius,
    color: style.color,
    field: underline,
  };
}

/** No click handlers, DOM mutations, layout wrappers, or workflow state changes. */
export function listenForGooeyInteractions(show: (frame: GooeyFrame | null) => void): () => void {
  const media = window.matchMedia(GOOEY_STATIC_QUERY);
  let active: GooeyTarget | null = null;
  let lastControl: HTMLElement | null = null;
  let lastStarted = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;

  function clear() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    observer?.disconnect();
    observer = undefined;
    if (active) { active = null; show(null); }
  }

  function start(event: Event) {
    if (media.matches || document.visibilityState === 'hidden') return;
    if (event instanceof PointerEvent && event.type === 'pointerover' && event.pointerType === 'touch') return;
    const target = getGooeyTarget(event.target);
    if (!target) return;
    if (event instanceof PointerEvent && event.type === 'pointerover' && event.relatedTarget instanceof Node && target.surface.contains(event.relatedTarget)) return;
    const now = performance.now();
    // Pointer entry, focus and press often describe the same single interaction.
    if (target.control === lastControl && now - lastStarted < GOOEY_DURATION) return;
    const frame = getGooeyFrame(target);
    if (!frame) return;
    clear();
    active = target;
    lastControl = target.control;
    lastStarted = now;
    show(frame);
    timer = setTimeout(clear, GOOEY_DURATION);
    // Async actions can disable/remove a control immediately after a press.
    observer = new MutationObserver(() => {
      if (!target.control.isConnected || target.control.matches(':disabled') || target.control.closest(excluded)) clear();
    });
    // Observe only eligibility attributes, not the library's per-frame transforms.
    for (let element: HTMLElement | null = target.control; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'inert', 'hidden'] });
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function leave(event: Event) {
    if (!active || !(event.target instanceof Node) || !active.surface.contains(event.target)) return;
    const related = (event as PointerEvent | FocusEvent).relatedTarget;
    if (!(related instanceof Node) || !active.surface.contains(related)) clear();
  }
  function preferencesChanged() { if (media.matches) clear(); }
  const starts = ['pointerover', 'pointerdown', 'focusin', 'change'] as const;
  starts.forEach((name) => document.addEventListener(name, start, true));
  document.addEventListener('pointerout', leave, true);
  document.addEventListener('focusout', leave, true);
  document.addEventListener('scroll', clear, true);
  document.addEventListener('visibilitychange', clear);
  window.addEventListener('resize', clear);
  window.addEventListener('blur', clear);
  media.addEventListener('change', preferencesChanged);
  return () => {
    clear();
    starts.forEach((name) => document.removeEventListener(name, start, true));
    document.removeEventListener('pointerout', leave, true);
    document.removeEventListener('focusout', leave, true);
    document.removeEventListener('scroll', clear, true);
    document.removeEventListener('visibilitychange', clear);
    window.removeEventListener('resize', clear);
    window.removeEventListener('blur', clear);
    media.removeEventListener('change', preferencesChanged);
  };
}
