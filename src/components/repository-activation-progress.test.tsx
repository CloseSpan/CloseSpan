import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RepositoryActivationProgress } from "./repository-activation-progress";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: vi.fn(),
  };
});

describe("RepositoryActivationProgress", () => {
  it("announces that execution preparation runs in the background", () => {
    const markup = renderToStaticMarkup(
      <RepositoryActivationProgress orgId="org-1" />,
    );
    expect(markup).toContain("Preparing repository execution");
    expect(markup).toContain("running alongside repository indexing");
    expect(markup).toContain('aria-live="polite"');
  });
});
