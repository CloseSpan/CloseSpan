import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceLoading } from "./workspace-loading";

describe("workspace loading placeholders", () => {
  it("announces loading and keeps the list layout by default", () => {
    const markup = renderToStaticMarkup(<WorkspaceLoading />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("skeleton-grid");
  });

  it("shapes detail pages as a header over a main column and an aside", () => {
    const markup = renderToStaticMarkup(<WorkspaceLoading variant="detail" />);
    expect(markup).toContain('class="loading-page loading-page-detail"');
    expect(markup).toContain("skeleton-eyebrow");
    expect(markup.match(/skeleton skeleton-panel/g)).toHaveLength(3);
  });
});
