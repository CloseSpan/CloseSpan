import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics } from "@/lib/overview-analytics";
import { ProblemsScreen } from "./screens";

describe("ProblemsScreen", () => {
  it("offers inventory, classification, and lifecycle board views", () => {
    const markup = renderToStaticMarkup(
      <ProblemsScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
      />,
    );

    expect(markup).toContain('aria-label="Product problem view"');
    expect(markup).toContain('id="problem-view-tab-problems"');
    expect(markup).toContain('id="problem-view-tab-classification"');
    expect(markup).toContain('id="problem-view-tab-board"');
    expect(markup).toContain(">Inventory<");
    expect(markup).toContain(">Classification<");
    expect(markup).toContain(">Board<");
    expect(markup).toContain("Problem inventory");
    expect(markup).not.toContain('aria-label="Prioritization view"');
  });
});
