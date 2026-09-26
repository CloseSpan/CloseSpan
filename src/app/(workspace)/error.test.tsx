import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorkspaceError from "./error";

describe("workspace error recovery", () => {
  it("offers a retry and a way back without claiming the backend is healthy", () => {
    const markup = renderToStaticMarkup(<WorkspaceError error={new Error("Database unavailable")} reset={vi.fn()} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry page");
    expect(markup).toContain('href="/overview"');
    expect(markup).toContain("Back to overview");
    expect(markup).not.toContain("workspace is still available");
    expect(markup).not.toContain("Database unavailable");
  });
});
