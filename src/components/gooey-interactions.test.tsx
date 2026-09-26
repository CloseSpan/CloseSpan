import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GooeyInteractions } from "./gooey-interactions";

describe("GooeyInteractions", () => {
  it("renders no decoration or browser-only machinery on the server", () => {
    expect(renderToStaticMarkup(<GooeyInteractions />)).toBe("");
  });

  it("leaves surrounding page controls unchanged during server rendering", () => {
    const content = <button type="button">Approve implementation</button>;
    expect(renderToStaticMarkup(<>{content}<GooeyInteractions /></>)).toBe(renderToStaticMarkup(content));
  });
});
