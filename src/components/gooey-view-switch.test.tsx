import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GooeyViewSwitch } from "./gooey-view-switch";

describe("GooeyViewSwitch", () => {
  it.each(["list", "board"] as const)("renders native controls with %s selected and an SSR-safe static highlight", (value) => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<GooeyViewSwitch value={value} onChange={onChange} />);
    expect(html).toContain('role="group" aria-label="Issue view"');
    expect(html).toContain('data-motion="static"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<button[^>]+aria-pressed="true"[^>]*>.*?${value === "list" ? "List" : "Board"}</button>`));
    expect(html).not.toContain("<filter");
    expect(onChange).not.toHaveBeenCalled();
  });
});
