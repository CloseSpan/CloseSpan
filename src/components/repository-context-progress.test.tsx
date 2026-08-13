import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RepositoryContextProgress } from "./repository-context-progress";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: vi.fn(),
  };
});

describe("RepositoryContextProgress", () => {
  it("exposes a labeled progress region while repository context is prepared", () => {
    const markup = renderToStaticMarkup(
      <RepositoryContextProgress orgId="org-1" />,
    );
    expect(markup).toContain("Learning your repositories");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Repository context creation"');
  });
});
