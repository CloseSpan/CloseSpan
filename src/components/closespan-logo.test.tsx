import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseSpanLogo } from "./closespan-logo";

describe("CloseSpanLogo", () => {
  it("renders the full code wordmark from semantic span elements", () => {
    const markup = renderToStaticMarkup(
      <CloseSpanLogo decorative={false} />,
    );

    expect(markup).toContain('aria-label="CloseSpan"');
    expect(markup).toContain('class="closespan-logo__syntax"');
    expect(markup).toContain('class="closespan-logo__close">Close</span>');
    expect(markup).toContain('class="closespan-logo__span">Span</span>');
    expect(markup).toContain("&lt;/");
    expect(markup).toContain("&gt;");
  });

  it("renders the compact syntax mark without the wordmark", () => {
    const markup = renderToStaticMarkup(
      <CloseSpanLogo variant="mark" />,
    );

    expect(markup).toContain("&lt;/");
    expect(markup).toContain("&gt;");
    expect(markup).not.toContain("closespan-logo__name");
  });

  it("exposes the requested light-surface and dark-surface tones", () => {
    const defaultMarkup = renderToStaticMarkup(<CloseSpanLogo />);
    const inverseMarkup = renderToStaticMarkup(
      <CloseSpanLogo tone="inverse" />,
    );

    expect(defaultMarkup).toContain("closespan-logo--default");
    expect(inverseMarkup).toContain("closespan-logo--inverse");
  });
});
