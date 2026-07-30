import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TenkiSandboxCheck } from "./tenki-sandbox-check";

describe("TenkiSandboxCheck", () => {
  it("renders a configured administrator action", () => {
    const html = renderToStaticMarkup(
      <TenkiSandboxCheck orgId="org_alpha" configured isAdmin />,
    );
    expect(html).toContain("Test Tenki sandbox");
    expect(html).toContain("Configured");
    expect(html).not.toContain("disabled");
  });

  it("disables the action when the key or administrator role is missing", () => {
    const html = renderToStaticMarkup(
      <TenkiSandboxCheck
        orgId="org_alpha"
        configured={false}
        isAdmin={false}
      />,
    );
    expect(html).toContain("Key required");
    expect(html).toContain("Administrator permission is required");
    expect(html).toContain("disabled");
  });
});
