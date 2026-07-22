import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConnectorInputGuidance,
  type ConnectorGuidanceMode,
} from "./connector-input-guidance";

function render(mode: ConnectorGuidanceMode): string {
  return renderToStaticMarkup(
    createElement(ConnectorInputGuidance, { mode }),
  );
}

describe("connector input guidance", () => {
  it("keeps compact cards concise without rendering an unbroken full URL", () => {
    const markup = render("compact");

    expect(markup).toContain("connector-input-guidance compact");
    expect(markup).toContain("Enter only the subdomain");
    expect(markup).toContain("miraai");
    expect(markup).not.toContain("https://");
    expect(markup).not.toContain(".zendesk.com");
  });

  it("retains complete setup help for spacious account-management views", () => {
    const markup = render("full");

    expect(markup).toContain("Enter only your Zendesk subdomain");
    expect(markup).toContain("https://miraai.zendesk.com");
  });

  it("renders nothing when contextual guidance is intentionally hidden", () => {
    expect(render("hidden")).toBe("");
  });
});
