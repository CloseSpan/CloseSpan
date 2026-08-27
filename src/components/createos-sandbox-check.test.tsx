import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateosSandboxCheck } from "./createos-sandbox-check";

describe("CreateosSandboxCheck", () => {
  it("renders a configured administrator action", () => {
    const html = renderToStaticMarkup(
      <CreateosSandboxCheck orgId="org_alpha" configured isAdmin />,
    );
    expect(html).toContain("Test CreateOS sandbox");
    expect(html).toContain("Configured");
    expect(html).not.toContain("disabled");
  });

  it("disables the action when the key or administrator role is missing", () => {
    const html = renderToStaticMarkup(
      <CreateosSandboxCheck
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
