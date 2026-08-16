import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FitText } from "./fit-text";

describe("FitText", () => {
  it("keeps text inside the requested semantic heading", () => {
    const markup = renderToStaticMarkup(
      <FitText as="h2" maxFontSize={42} maxLines={3} minFontSize={28}>
        Customer feedback operations
      </FitText>,
    );

    expect(markup).toContain("<h2");
    expect(markup).toContain("data-fit-lines=\"3\"");
    expect(markup).toContain(">Customer feedback operations</h2>");
  });
});
