import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOEY_DURATION, GOOEY_STATIC_QUERY, getGooeyFrame, getGooeyTarget, listenForGooeyInteractions } from "./gooey-interactions";

// Small DOM fakes keep these delegated-event tests runnable in the Node suite.
class TestEventTarget extends EventTarget {
  // Node's EventTarget does not normalize boolean capture on removal like the DOM.
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, listener, typeof options === "boolean" ? { capture: options } : options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, listener, typeof options === "boolean" ? { capture: options } : options);
  }
}
class TestNode extends EventTarget {
  parent: TestElement | null = null;
  isConnected = true;
  contains(node: TestNode): boolean { return node === this || Boolean(node.parent && this.contains(node.parent)); }
}

class TestElement extends TestNode {
  attributes = new Map<string, string>();
  disabled = false;
  type = "";
  rect = { left: 20, top: 30, width: 100, height: 40, right: 120, bottom: 70 };
  style = { visibility: "visible", display: "inline-flex", borderRadius: "8px", color: "rgb(30, 30, 30)", overflowX: "visible", overflowY: "visible", clipPath: "none", opacity: "1" };
  get parentElement() { return this.parent; }
  constructor(readonly tagName = "button", parent: TestElement | null = null) { super(); this.parent = parent; }
  matches(selectors: string): boolean {
    return selectors.split(",").some((raw) => {
      const selector = raw.trim();
      if (selector === ":disabled") return this.disabled;
      if (selector.startsWith(".")) return (this.attributes.get("class") ?? "").split(" ").includes(selector.slice(1));
      const attribute = selector.match(/^([a-z-]+)?\[([^=\]]+)(?:="([^"]+)")?\]$/);
      if (attribute) {
        const [, tag, name, value] = attribute;
        if (tag && tag !== this.tagName) return false;
        const actual = name === "type" ? this.type : this.attributes.get(name);
        return value === undefined ? actual !== undefined : actual === value;
      }
      return selector === this.tagName;
    });
  }
  closest<T extends TestElement>(selector: string): T | null {
    return this.matches(selector) ? this as unknown as T : this.parent?.closest<T>(selector) ?? null;
  }
  getBoundingClientRect() { return this.rect; }
}
class TestInput extends TestElement { constructor(type = "text", parent: TestElement | null = null) { super("input", parent); this.type = type; } }
class TestTextarea extends TestElement { constructor(parent: TestElement | null = null) { super("textarea", parent); } }
class TestSelect extends TestElement { constructor() { super("select"); } }
class TestLabel extends TestElement { control: TestInput | null = null; constructor() { super("label"); } }
class TestPointerEvent extends Event {
  pointerType: string;
  relatedTarget: TestNode | null;
  constructor(type: string, options: { pointerType?: string; relatedTarget?: TestNode | null } = {}) {
    super(type, { cancelable: true });
    this.pointerType = options.pointerType ?? "mouse";
    this.relatedTarget = options.relatedTarget ?? null;
  }
}

let observers: TestMutationObserver[];
class TestMutationObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: () => void) { observers.push(this); }
}

describe("gooey interaction targeting", () => {
  let browserDocument: EventTarget & { visibilityState: string };
  let browserWindow: EventTarget;
  let media: EventTarget & { matches: boolean };
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    observers = [];
    browserDocument = Object.assign(new TestEventTarget(), { visibilityState: "visible", body: new TestElement("body") });
    media = Object.assign(new TestEventTarget(), { matches: false });
    browserWindow = Object.assign(new TestEventTarget(), {
      innerWidth: 1440,
      innerHeight: 900,
      getComputedStyle: (element: TestElement) => element.style,
      matchMedia: vi.fn().mockReturnValue(media),
    });
    vi.stubGlobal("Node", TestNode);
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("HTMLElement", TestElement);
    vi.stubGlobal("HTMLInputElement", TestInput);
    vi.stubGlobal("HTMLTextAreaElement", TestTextarea);
    vi.stubGlobal("HTMLSelectElement", TestSelect);
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("window", browserWindow);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function dispatch(type: string, target: TestNode, options: { pointerType?: string; relatedTarget?: TestNode | null } = {}) {
    const event = type.startsWith("pointer") ? new TestPointerEvent(type, options) : Object.assign(new Event(type, { cancelable: true }), { relatedTarget: options.relatedTarget ?? null });
    Object.defineProperty(event, "target", { value: target });
    browserDocument.dispatchEvent(event);
    return event;
  }

  it("discovers nested button content and controls added after listener setup", () => {
    const show = vi.fn();
    cleanup = listenForGooeyInteractions(show);
    const button = new TestElement();
    const icon = new TestElement("svg", button);
    expect(getGooeyTarget(icon)).toMatchObject({ control: button, surface: button, field: false });
    dispatch("pointerover", icon);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ left: 21, top: 31, width: 98, height: 38 }));
  });

  it.each(["inert", "hidden", "aria-disabled", "data-gooey", "data-gooey-view-switch", "data-gooey-overlay", "data-gooey-interaction", "contenteditable"])("ignores controls inside %s exclusions", (attribute) => {
    const parent = new TestElement("div");
    parent.attributes.set(attribute, attribute === "data-gooey" ? "off" : "true");
    expect(getGooeyTarget(new TestElement("button", parent))).toBeNull();
  });

  it("ignores disabled, hidden and non-control targets", () => {
    const disabled = new TestElement();
    disabled.disabled = true;
    expect(getGooeyTarget(disabled)).toBeNull();
    expect(getGooeyTarget(new TestInput("hidden"))).toBeNull();
    expect(getGooeyTarget(new TestElement("p"))).toBeNull();
    expect(getGooeyTarget(null)).toBeNull();
  });

  it("uses visible field shells and preserves native choice labels", () => {
    const shell = new TestElement("div");
    shell.attributes.set("data-field-shell", "");
    const field = new TestInput("search", shell);
    const target = getGooeyTarget(field)!;
    expect(target.surface).toBe(shell);
    expect(getGooeyFrame(target)).toMatchObject({ top: 66, height: 3, radius: "2px", field: true });
    const label = new TestLabel();
    label.control = new TestInput("radio", label);
    label.control.rect = { left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1 };
    expect(getGooeyTarget(new TestElement("span", label))).toMatchObject({ control: label.control, surface: label, field: false });
  });

  it("uses underlines for inline links without covering their text", () => {
    const link = new TestElement("a");
    link.attributes.set("href", "/issues");
    link.style.display = "inline";
    expect(getGooeyFrame(getGooeyTarget(link)!)).toMatchObject({ height: 3, top: 66, field: true });
  });

  it("decorates a choice's visible label when CSS clips a full-sized native radio", () => {
    const label = new TestLabel();
    label.control = new TestInput("radio", label);
    label.control.style.clipPath = "inset(50%)";
    expect(getGooeyTarget(label.control)).toMatchObject({ control: label.control, surface: label });
  });

  it.each(["disconnected", "invisible", "oversized", "offscreen"])("does not decorate %s controls", (state) => {
    const control = new TestElement();
    if (state === "disconnected") control.isConnected = false;
    if (state === "invisible") control.style.visibility = "hidden";
    if (state === "oversized") control.rect.height = 400;
    if (state === "offscreen") control.rect.top = 1000;
    expect(getGooeyFrame(getGooeyTarget(control)!)).toBeNull();
  });

  it("clips the response to scrollable ancestors and rejects fully clipped controls", () => {
    const parent = new TestElement("div");
    parent.style.overflowY = "auto";
    parent.style.overflowX = "hidden";
    parent.rect = { left: 40, top: 40, width: 60, height: 20, right: 100, bottom: 60 };
    const control = new TestElement("button", parent);
    expect(getGooeyFrame(getGooeyTarget(control)!)).toMatchObject({ left: 40, top: 40, width: 60, height: 20 });
    parent.rect.top = 80;
    parent.rect.bottom = 100;
    expect(getGooeyFrame(getGooeyTarget(control)!)).toBeNull();
  });

  it.each(["reduced motion", "forced colors"])("does not mount a response while %s matches the shared preference query", () => {
    media.matches = true;
    const show = vi.fn();
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerdown", new TestElement());
    expect(window.matchMedia).toHaveBeenCalledWith(GOOEY_STATIC_QUERY);
    expect(GOOEY_STATIC_QUERY).toContain("prefers-reduced-motion: reduce");
    expect(GOOEY_STATIC_QUERY).toContain("forced-colors: active");
    expect(show).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears an active response immediately when motion preferences change", () => {
    const show = vi.fn();
    cleanup = listenForGooeyInteractions(show);
    dispatch("focusin", new TestElement());
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(show).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("deduplicates pointer, focus and press events, then permits another interaction", () => {
    const show = vi.fn();
    const control = new TestElement();
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerover", control);
    dispatch("focusin", control);
    dispatch("pointerdown", control);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GOOEY_DURATION);
    expect(show).toHaveBeenLastCalledWith(null);
    dispatch("pointerdown", control);
    expect(show).toHaveBeenCalledTimes(3);
  });

  it("ignores touch hover and internal pointer movement but responds to touch press", () => {
    const show = vi.fn();
    const control = new TestElement();
    const child = new TestElement("span", control);
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerover", control, { pointerType: "touch" });
    dispatch("pointerover", child, { relatedTarget: control });
    expect(show).not.toHaveBeenCalled();
    dispatch("pointerdown", control, { pointerType: "touch" });
    expect(show).toHaveBeenCalledOnce();
  });

  it("leaves original action events untouched and never responds to click itself", () => {
    const show = vi.fn();
    const control = new TestElement();
    const action = vi.fn();
    browserDocument.addEventListener("pointerdown", action);
    cleanup = listenForGooeyInteractions(show);
    const press = dispatch("pointerdown", control);
    expect(press.defaultPrevented).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(GOOEY_DURATION);
    show.mockClear();
    dispatch("click", control);
    expect(show).not.toHaveBeenCalled();
  });

  it("clears on leaving a control, but not when entering its children", () => {
    const show = vi.fn();
    const control = new TestElement();
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerdown", control);
    dispatch("pointerout", control, { relatedTarget: new TestElement("span", control) });
    expect(show).toHaveBeenCalledOnce();
    dispatch("pointerout", control);
    expect(show).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["scroll", "visibilitychange", "resize", "blur"])("clears a response on %s", (name) => {
    const show = vi.fn();
    cleanup = listenForGooeyInteractions(show);
    dispatch("focusin", new TestElement());
    (name === "resize" || name === "blur" ? browserWindow : browserDocument).dispatchEvent(new Event(name));
    expect(show).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a response when an asynchronous action disables the control", () => {
    const show = vi.fn();
    const control = new TestElement();
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerdown", control);
    control.disabled = true;
    observers[0].callback();
    expect(show).toHaveBeenLastCalledWith(null);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["removal", "inert ancestor"])("clears immediately after %s", (state) => {
    const show = vi.fn();
    const parent = new TestElement("div");
    const control = new TestElement("button", parent);
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerdown", control);
    if (state === "removal") control.isConnected = false;
    else parent.attributes.set("inert", "");
    observers[0].callback();
    expect(show).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an effect in a hidden tab", () => {
    const show = vi.fn();
    browserDocument.visibilityState = "hidden";
    cleanup = listenForGooeyInteractions(show);
    dispatch("change", new TestInput("checkbox"));
    expect(show).not.toHaveBeenCalled();
  });

  it("removes listeners, timers and observers when disposed", () => {
    const show = vi.fn();
    cleanup = listenForGooeyInteractions(show);
    dispatch("pointerdown", new TestElement());
    cleanup();
    cleanup = undefined;
    expect(vi.getTimerCount()).toBe(0);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    show.mockClear();
    for (const event of ["pointerover", "pointerdown", "focusin", "change", "pointerout", "focusout"]) dispatch(event, new TestElement());
    browserDocument.dispatchEvent(new Event("scroll"));
    browserWindow.dispatchEvent(new Event("resize"));
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(GOOEY_DURATION * 2);
    expect(show).not.toHaveBeenCalled();
  });
});
