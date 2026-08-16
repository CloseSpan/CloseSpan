import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotionTextReveal } from "./motion-text-reveal";

describe("MotionTextReveal", () => {
  it("renders an accessible semantic heading before hydration", () => {
    const text = "Turn customer feedback into product improvements.";
    const markup = renderToStaticMarkup(
      <MotionTextReveal highlight="product improvements." text={text} />,
    );

    expect(markup).toContain(`<h1 aria-label="${text}"`);
    expect(markup).toContain("data-motion-text-reveal=\"true\"");
    expect(markup).toContain("motion-text-reveal-accent");
    expect(markup).toContain("product</span> <span");
    expect(markup).toContain("improvements.</span>");
  });
});
