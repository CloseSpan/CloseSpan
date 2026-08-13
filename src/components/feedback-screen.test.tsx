import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { feedback } from "@/lib/seed";
import { classificationConfidenceLabel, FeedbackScreen } from "./screens";

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
});
