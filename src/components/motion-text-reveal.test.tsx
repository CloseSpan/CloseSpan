import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotionTextReveal } from "./motion-text-reveal";

describe("MotionTextReveal", () => {
  it("renders an accessible semantic heading before hydration", () => {
    const text = "Turn customer feedback into improvements ready to ship";
    const markup = renderToStaticMarkup(
      <MotionTextReveal highlight="into improvements ready to ship" text={text} />,
    );

    expect(markup).toContain(`<h1 aria-label="${text}"`);
    expect(markup).toContain("data-motion-text-reveal=\"true\"");
    expect(markup).toContain("motion-text-reveal-accent");
    expect(markup).toContain("into</span> <span");
    expect(markup).toContain("ship</span>");
  });
});
