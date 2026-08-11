import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics } from "@/lib/overview-analytics";
import { PrioritizationScreen } from "./screens";

describe("PrioritizationScreen", () => {
  it("renders the impact queue without the lifecycle board", () => {
    const markup = renderToStaticMarkup(
      <PrioritizationScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
      />,
    );

    expect(markup).toContain("Impact review queue");
    expect(markup).toContain("Priority drivers");
    expect(markup).toContain("Review evidence");
    expect(markup).toContain("Review policy settings");
    expect(markup).toContain("Affected revenue sets the current queue order");
    expect(markup).not.toContain('class="problem-table"');
    expect(markup).not.toContain('aria-label="Prioritization view"');
    expect(markup).not.toContain('class="board"');
  });
});
