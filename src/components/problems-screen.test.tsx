import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics } from "@/lib/overview-analytics";
import { ProblemLifecycleBoard, ProblemsScreen } from "./screens";

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

  it("shows one-word active work with a spinner on the matching board card", () => {
    const analytics = calculateOverviewAnalytics(
      new Date("2026-07-21T18:00:00.000Z"),
    );
    const problem = analytics.problems[0];
    const markup = renderToStaticMarkup(
      <ProblemLifecycleBoard
        problems={analytics.problems}
        activeWork={[
          {
            problemId: problem.id,
            status: "Tenki",
            startedAt: "2026-08-11T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Tenki in progress"');
    expect(markup).toContain("problem-card-work-spinner");
    expect(markup.match(/problem-card-work-status/g)).toHaveLength(1);
  });
});
