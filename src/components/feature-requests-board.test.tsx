import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureRequestsBoard } from "./feature-requests-board";
import { TURNSTILE_TEST_SITE_KEY } from "@/lib/turnstile-config";

describe("FeatureRequestsBoard", () => {
  it("shows one centered request action in the empty roadmap state", () => {
    const markup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[]}
      />,
    );

    expect(markup).toContain("Start the roadmap conversation");
    expect(markup.match(/New request/g)).toHaveLength(1);
    expect(markup).not.toContain("feature-request-vote-note");
  });

  it("renders grouped requests with separate accessible vote counts", () => {
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
            upvoteCount: 7,
            downvoteCount: 2,
            viewerVote: "up",
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("Feature requests");
    expect(markup).toContain("Add release health summaries");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Upvote Add release health summaries. 7 upvotes");
    expect(markup).toContain("Downvote Add release health summaries. 2 downvotes");
    expect(markup).toContain(
      "One upvote or downvote per request, per network address",
    );
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
            upvoteCount: 0,
            downvoteCount: 0,
            viewerVote: null,
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
            upvoteCount: 0,
            downvoteCount: 0,
            viewerVote: null,
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

    expect(moderatorMarkup).toContain("Request review");
    expect(moderatorMarkup).toContain("Publish");
    expect(moderatorMarkup).toContain("feature-request-new");
    expect(moderatorMarkup).not.toContain("Start the roadmap conversation");
    expect(publicMarkup).not.toContain("Request review");
    expect(publicMarkup).toContain("Start the roadmap conversation");
  });

  it("keeps rejected moderator requests visible with a struck state", () => {
    const markup = renderToStaticMarkup(
      <FeatureRequestsBoard
        turnstileSiteKey={TURNSTILE_TEST_SITE_KEY}
        initialRequests={[]}
        initialPendingRequests={[
          {
            id: "55555555-5555-4555-8555-555555555555",
            title: "Remove the roadmap history",
            description: "This rejected request should remain inspectable.",
            moderationStatus: "Rejected",
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ]}
        canModerate
      />,
    );

    expect(markup).toContain('class="rejected"');
    expect(markup).toContain("Rejected");
    expect(markup).not.toContain(">Publish<");
  });
});
