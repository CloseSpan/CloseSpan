import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessRequestEmail } from "./access-request-email";

describe("AccessRequestEmail", () => {
  it("renders an explicit founder email action without automatic navigation", () => {
    const html = renderToStaticMarkup(
      <AccessRequestEmail
        adminEmail="shanmukhsain@gmail.com"
        mailtoUrl="mailto:shanmukhsain@gmail.com?subject=CloseSpan"
      />,
    );

    expect(html).toContain("Email the founder");
    expect(html).toContain("mailto:shanmukhsain@gmail.com?subject=CloseSpan");
    expect(html).toContain("You can add your question before sending it.");
    expect(html).not.toContain("script");
  });
});
