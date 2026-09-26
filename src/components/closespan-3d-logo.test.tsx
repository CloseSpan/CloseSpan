import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseSpan3DLogo } from "./closespan-3d-logo";

describe("CloseSpan3DLogo", () => {
  it("renders the flat wordmark without theme-specific image downloads", () => {
    const markup = renderToStaticMarkup(<CloseSpan3DLogo />);

    expect(markup).toContain("closespan-logo__name");
    expect(markup).not.toContain("<img");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("can expose the brand name to assistive technology", () => {
    const markup = renderToStaticMarkup(
      <CloseSpan3DLogo decorative={false} size="lg" />,
    );

    expect(markup).toContain('aria-label="CloseSpan"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain("closespan-3d-logo--lg");
  });
});
