import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateOverviewAnalytics, createEmptyOverviewAnalytics } from "@/lib/overview-analytics";
import { ProblemLifecycleBoard, ProblemsScreen } from "./screens";

describe("ProblemsScreen", () => {
  it("gives an empty issue list a clear next action", () => {
    const markup = renderToStaticMarkup(<ProblemsScreen analytics={createEmptyOverviewAnalytics()} />);
    expect(markup).toContain("<h1>Issues</h1>");
    expect(markup).toContain("No issues yet");
    expect(markup).toContain('href="/feedback"');
    expect(markup).toContain("Open feedback inbox");
    expect(markup).not.toContain("placeholder clusters");
  });
  it("offers inventory, classification, and lifecycle board views", () => {
    const markup = renderToStaticMarkup(
      <ProblemsScreen
        analytics={calculateOverviewAnalytics(
          new Date("2026-07-21T18:00:00.000Z"),
        )}
      />,
    );

    expect(markup).toContain('aria-label="Issue view"');
    expect(markup).toContain('id="problem-view-tab-problems"');
    expect(markup).toContain('id="problem-view-tab-classification"');
    expect(markup).toContain('id="problem-view-tab-board"');
    expect(markup).toContain(">List<");
    expect(markup).toContain(">Classification<");
    expect(markup).toContain(">Board<");
    expect(markup).toContain("All issues");
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
    expect(markup).toContain('class="problem-card-title"');
    expect(markup).toContain(`title="${problem.title}"`);
    expect(markup).toContain("Release Ready");
  });
});
