import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IssueResultReview } from "./issue-result-review";
import type { IssueResultReviewState } from "@/lib/issue-result-review";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: IssueResultReviewState = {
  storageReady: true, binding: { runId: "run", commitSha: "a".repeat(40), promptHash: "b".repeat(64) },
  version: 0, latestDecision: null, canReview: true, unavailableReason: null, reworkRecommendation: null,
};
describe("domain result review", () => {
  it("gives domain experts outcome decisions without merge authority", () => {
    const html = renderToStaticMarkup(<IssueResultReview problemId="issue" initial={initial} canReview canManage={false} demo={false} />);
    expect(html).toContain("This works"); expect(html).toContain("Needs changes");
    expect(html).toContain("Coding and merging need separate approval");
    expect(html).not.toContain("Approve and merge");
  });
  it("keeps sample buttons disabled and viewers read-only", () => {
    const demo = renderToStaticMarkup(<IssueResultReview problemId="issue" initial={initial} canReview canManage demo />);
    expect(demo).toMatch(/<button[^>]*disabled=""[^>]*>This works/);
    const viewer = renderToStaticMarkup(<IssueResultReview problemId="issue" initial={initial} canReview={false} canManage={false} demo={false} />);
    expect(viewer).not.toContain("<button");
  });
  it("does not treat an old commit's acceptance as current", () => {
    const html = renderToStaticMarkup(<IssueResultReview problemId="issue" canReview canManage demo={false} initial={{ ...initial,
      latestDecision: { ...initial.binding!, id: "decision", version: 1, decision: "accept", feedback: "", actorName: "Sam", createdAt: "2026-09-15", current: false },
    }} />);
    expect(html).toContain("result changed since the last review");
    expect(html).not.toContain("Sam confirmed");
  });
  it("requires separate administrator authorization for follow-up work", () => {
    const review: IssueResultReviewState = { ...initial, version: 1,
      latestDecision: { ...initial.binding!, id: "decision", version: 1, decision: "changes", feedback: "The CSV is still empty.", actorName: "Sam", createdAt: "2026-09-15", current: true },
      rework: { available: true, unavailableReason: null, runId: null },
    };
    const admin = renderToStaticMarkup(<IssueResultReview problemId="issue" initial={review} canReview canManage demo={false} />);
    expect(admin).toContain("Approve follow-up run");
    expect(admin).not.toContain(">This works</button>");
    expect(admin).not.toContain("Approve and start follow-up");
    const contributor = renderToStaticMarkup(<IssueResultReview problemId="issue" initial={review} canReview canManage={false} demo={false} />);
    expect(contributor).not.toContain("Approve follow-up run");
  });
});
