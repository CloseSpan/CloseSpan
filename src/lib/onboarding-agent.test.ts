import { describe, expect, it } from "vitest";
import { inferConnectorsFromText } from "./integration-catalog";
import { runOnboardingTurn } from "./onboarding-agent";
import { defaultOnboardingState } from "./onboarding-repository";
import { discoverFeedbackSourcesFromProduct } from "./product-source-discovery";

describe("inferConnectorsFromText", () => {
  it("maps zendesk and github mentions to catalog connectors", () => {
    const connectors = inferConnectorsFromText(
      "We use Zendesk for support tickets and GitHub for engineering.",
    );
    const ids = connectors.map((item) => item.integrationId);
    expect(ids).toContain("int_zendesk");
    expect(ids).toContain("int_github");
  });

  it("falls back to webhook when no keywords match", () => {
    const connectors = inferConnectorsFromText("unknown stack");
    expect(connectors[0]?.integrationId).toBe("int_webhook");
  });
});

describe("discoverFeedbackSourcesFromProduct", () => {
  it("infers app store sources for mobile products", async () => {
    const result = await discoverFeedbackSourcesFromProduct({
      orgId: "org_test",
      productBrief: "A consumer iOS and Android fitness mobile app",
    });
    const ids = result.recommendedConnectors.map((item) => item.integrationId);
    expect(result.understanding).toMatchObject({
      productType: "consumer_mobile",
      productDescription: "A consumer iOS and Android fitness mobile app",
    });
    expect(ids).toContain("int_app_store");
    expect(ids).toContain("int_play_store");
  });

  it("infers zendesk/slack for b2b saas", async () => {
    const result = await discoverFeedbackSourcesFromProduct({
      orgId: "org_test",
      productBrief: "B2B SaaS analytics dashboard for enterprise teams",
    });
    const ids = result.recommendedConnectors.map((item) => item.integrationId);
    expect(result.understanding.productType).toBe("b2b_saas");
    expect(ids).toContain("int_zendesk");
    expect(ids).toContain("int_slack");
  });
});

describe("runOnboardingTurn product-first", () => {
  it("discovers connectors from a product brief without asking for tools", async () => {
    const state = defaultOnboardingState();
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "Feelow AI",
      state: {
        ...state,
        messages: [
          {
            role: "assistant",
            content: "Hi",
            at: new Date().toISOString(),
          },
          {
            role: "user",
            content: "B2B analytics SaaS for enterprise teams",
            at: new Date().toISOString(),
          },
        ],
      },
      userMessage: "B2B analytics SaaS for enterprise teams",
    });

    expect(turn.phase).toBe("connect");
    expect(turn.productProfile.productDescription).toBeTruthy();
    expect(turn.recommendedConnectors.length).toBeGreaterThan(0);
    expect(
      turn.recommendedConnectors.some((item) =>
        ["int_zendesk", "int_slack", "int_intercom"].includes(item.integrationId),
      ),
    ).toBe(true);
  });
});
