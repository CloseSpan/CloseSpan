import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureRequestsBoard } from "./feature-requests-board";
import { TURNSTILE_TEST_SITE_KEY } from "@/lib/turnstile-config";

describe("FeatureRequestsBoard", () => {
  it("renders grouped requests with accessible one-way vote state", () => {
    const markup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Add release health summaries",
            description: "Show feedback changes before and after every release.",
            status: "Planned",
            votingOpen: true,
            voteCount: 7,
            viewerHasVoted: true,
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("Feature requests");
    expect(markup).toContain("Add release health summaries");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("One vote per request, per network address");
    expect(markup).toContain("New request");
    expect(markup).toContain("turnstile-challenge");
  });

  it("fails closed in the UI when the Turnstile site key is unavailable", () => {
    const markup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey=""
        initialRequests={[
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Protect anonymous voting",
            description: "Require browser verification before recording votes.",
            status: "Backlog",
            votingOpen: true,
            voteCount: 0,
            viewerHasVoted: false,
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("Security verification is temporarily unavailable");
    expect(markup).toContain("disabled");
  });

  it("escapes submitted content instead of treating it as markup", () => {
    const markup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "<script>alert('no')</script>",
            description: "Keep this request safely rendered as plain text.",
            status: "Backlog",
            votingOpen: true,
            voteCount: 0,
            viewerHasVoted: false,
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>alert");
  });

  it("shows the private review queue only to moderators", () => {
    const pending = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Add a moderated roadmap request",
        description: "Let the product owner review this before publication.",
        moderationStatus: "Pending review" as const,
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    ];
    const moderatorMarkup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[]}
        initialPendingRequests={pending}
        canModerate
      />,
    );
    const publicMarkup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[]}
        initialPendingRequests={pending}
      />,
    );

    expect(moderatorMarkup).toContain("Waiting for review");
    expect(moderatorMarkup).toContain("Publish");
    expect(publicMarkup).not.toContain("Waiting for review");
  });
});
