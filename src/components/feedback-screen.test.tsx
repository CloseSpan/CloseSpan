import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { feedback } from "@/lib/seed";
import {
  classificationConfidenceLabel,
  FeedbackScreen,
  formatFeedbackReportedAt,
  orderFeedbackByReportedAt,
} from "./screens";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("FeedbackScreen sentiment", () => {
  it("uses sentiment, not severity, as the inbox-level customer signal", () => {
    const item = feedback[0];
    const markup = renderToStaticMarkup(
      <FeedbackScreen
        feedbackItems={[item]}
        orgId={item.orgId}
        providerLabel="OpenAI"
        initialAnalyses={[{
          feedbackId: item.id,
          classification: "Bug",
          severity: "High",
          sentiment: "Negative",
          sentimentIntensity: 0.72,
          sentimentConfidence: 0.91,
          sentimentEvidence: ["The customer reports a failed workflow."],
          sentimentRationale: "The reported failure is an adverse outcome.",
          redactedSummary: "The workflow produces an empty result.",
          proposedProblemId: null,
          classificationConfidence: 0.88,
          clusterConfidence: 0,
          rationale: "The existing behavior is explicitly reported as broken.",
          evidence: ["The output is empty."],
          reviewStatus: "Proposed",
        }]}
      />,
    );

    expect(markup).toContain("<th>Sentiment</th>");
    expect(markup).not.toContain("<th>Severity</th>");
    expect(markup).toContain("feedback-sentiment is-negative");
    expect(markup).toContain(">Negative<");
  });

  it("names classification confidence explicitly", () => {
    expect(classificationConfidenceLabel(0.84)).toBe(
      "84% classification confidence",
    );
  });

  it("does not invent sentiment for analyses created before sentiment existed", () => {
    const item = feedback[0];
    const markup = renderToStaticMarkup(
      <FeedbackScreen
        feedbackItems={[item]}
        orgId={item.orgId}
        providerLabel="OpenAI"
      />,
    );

    expect(markup).toContain("Not analyzed");
  });

  it("shows the linked problem title instead of using its internal id as copy", () => {
    const item = {
      ...feedback[0],
      problemId: "prob_caption_undo",
      observedAt: "2026-08-18T20:17:35.073Z",
    };
    const markup = renderToStaticMarkup(
      <FeedbackScreen
        feedbackItems={[item]}
        orgId={item.orgId}
        providerLabel="OpenAI"
        problemOptions={[
          {
            id: "prob_caption_undo",
            title: "Caption regeneration needs an undo option",
            stage: "Detected",
          },
        ]}
      />,
    );

    expect(markup).toContain("Caption regeneration needs an undo option");
    expect(markup).not.toContain(">prob_caption_undo<");
    expect(markup).toContain('href="/problems/prob_caption_undo"');
  });

  it("defaults the Reported column to newest first with a readable UTC date", () => {
    const item = {
      ...feedback[0],
      observedAt: "2026-08-18T20:17:35.073Z",
    };
    const markup = renderToStaticMarkup(
      <FeedbackScreen
        feedbackItems={[item]}
        orgId={item.orgId}
        providerLabel="OpenAI"
      />,
    );

    expect(markup).toContain('aria-sort="descending"');
    expect(markup).toContain("Reported date, newest first");
    expect(markup).toContain("Aug 18, 2026");
    expect(markup).toContain("8:17 PM UTC");
  });

  it("orders valid dates in either direction and leaves missing dates last", () => {
    const oldest = {
      ...feedback[0],
      id: "fb_oldest",
      observedAt: "2026-08-01T10:00:00.000Z",
    };
    const newest = {
      ...feedback[0],
      id: "fb_newest",
      observedAt: "2026-08-18T10:00:00.000Z",
    };
    const unknown = {
      ...feedback[0],
      id: "fb_unknown",
      observedAt: "unknown",
    };

    expect(orderFeedbackByReportedAt([oldest, unknown, newest], "recent").map((item) => item.id))
      .toEqual(["fb_newest", "fb_oldest", "fb_unknown"]);
    expect(orderFeedbackByReportedAt([newest, unknown, oldest], "first").map((item) => item.id))
      .toEqual(["fb_oldest", "fb_newest", "fb_unknown"]);
    expect(formatFeedbackReportedAt("unknown")).toEqual({
      date: "Date unavailable",
      time: null,
    });
  });

  it("renders feedback details as a focused page instead of a modal drawer", () => {
    const item = feedback[0];
    const markup = renderToStaticMarkup(
      <FeedbackScreen
        feedbackItems={[item]}
        orgId={item.orgId}
        providerLabel="OpenAI"
        initialOpenFeedbackId={item.id}
        initialAnalyses={[{
          feedbackId: item.id,
          classification: "Feature request",
          severity: "Low",
          sentiment: "Neutral",
          sentimentIntensity: 0.2,
          sentimentConfidence: 0.89,
          sentimentEvidence: [],
          sentimentRationale: "The request is neutral in tone.",
          redactedSummary: "Add more useful actions to the three-dot menu.",
          proposedProblemId: null,
          classificationConfidence: 0.96,
          clusterConfidence: 0,
          rationale: "The customer asks for expanded menu functionality.",
          evidence: ["The current menu duplicates the existing edit action."],
          reviewStatus: "Approved",
        }]}
      />,
    );

    expect(markup).toContain('class="feedback-detail-page"');
    expect(markup).toContain("Feedback inbox");
    expect(markup).toContain("Customer feedback");
    expect(markup).toContain("Signal overview");
    expect(markup).toContain("More signal details");
    expect(markup).toContain("Why CloseSpan made this recommendation");
    expect(markup).not.toContain("feedback-drawer-layer");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("Where this feedback goes");
  });
});
