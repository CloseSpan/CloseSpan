import { describe, expect, it } from "vitest";
import {
  inferConnectorsFromText,
  isFeedbackSourceIntegration,
  isIntegrationAvailable,
} from "./integration-catalog";
import {
  confirmCompanyProfileTurn,
  initializeOnboardingState,
  onboardingGuidanceForWorkspace,
  runOnboardingTurn,
  type OnboardingWorkspaceConnectionStatus,
} from "./onboarding-agent";
import {
  defaultOnboardingState,
  type OnboardingState,
} from "./onboarding-repository";
import { discoverFeedbackSourcesFromProduct } from "./product-source-discovery";

const emptyWorkspaceStatus: OnboardingWorkspaceConnectionStatus = {
  connectedIntegrationIds: [],
  feedbackConnected: false,
  githubConnected: false,
  aiConfigured: false,
  setupComplete: false,
};

function connectorState(): OnboardingState {
  return {
    phase: "connect",
    productProfile: {
      productName: "Northstar",
      productUrl: null,
      productDescription: "B2B analytics SaaS",
      companyProfileConfirmed: true,
      feedbackSources: [],
      engineeringTools: [],
    },
    recommendedConnectors: [
      {
        integrationId: "int_github",
        provider: "GitHub",
        reason: "Engineering handoff",
        priority: "recommended",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_zendesk",
        provider: "Zendesk",
        reason: "Support feedback",
        priority: "required",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_linear",
        provider: "Linear",
        reason: "Not yet connectable",
        priority: "optional",
        connectionMethod: "oauth",
      },
    ],
    messages: [
      { role: "assistant", content: "Connect sources", at: "2026-07-20T10:00:00Z" },
      { role: "user", content: "I tried", at: "2026-07-20T10:01:00Z" },
    ],
  };
}

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

  it("recommends Pipedream catalog entries with a live setup path", () => {
    const connectors = inferConnectorsFromText("We use Jira for project planning");
    expect(connectors.map((connector) => connector.integrationId)).toEqual([
      "int_webhook",
      "int_jira",
    ]);
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
  it("redirects unrelated requests without changing onboarding data", async () => {
    const state = connectorState();
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
      state,
      userMessage: "Tell me a joke about penguins",
      workspaceStatus: {
        ...emptyWorkspaceStatus,
        connectedIntegrationIds: ["int_github"],
        githubConnected: true,
      },
    });

    expect(turn.assistantMessage).toBe(
      "I can help connect feedback sources, manage GitHub setup, or explain this onboarding flow. What would you like to connect?",
    );
    expect(turn.phase).toBe(state.phase);
    expect(turn.productProfile).toEqual(state.productProfile);
    expect(turn.recommendedConnectors).toEqual(state.recommendedConnectors);
    expect(turn.suggestedReplies).toEqual([
      "Connect a recommended source",
      "Show connected sources",
      "Continue onboarding",
    ]);
  });

  it("does not mistake an unrelated question for a company description", async () => {
    const state = defaultOnboardingState();
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
      state,
      userMessage: "What is the capital of France?",
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(turn.assistantMessage).toContain(
      "I can help connect feedback sources",
    );
    expect(turn.productProfile).toEqual(state.productProfile);
    expect(turn.recommendedConnectors).toEqual([]);
    expect(turn.suggestedReplies).toEqual([
      "Send company website",
      "We don't have a website yet",
    ]);
  });

  it("keeps GitHub as the only next-step message until it is connected", async () => {
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
      state: connectorState(),
      userMessage: "What should I connect next?",
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(turn.assistantMessage).toBe(
      "Connect GitHub first so you can choose the repositories CloseSpan may test and use for approved PRs.",
    );
    expect(turn.recommendedConnectors[0]?.integrationId).toBe("int_github");
    expect(turn.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_github" }),
    );
    expect(turn.suggestedReplies).toEqual(["Connect GitHub"]);
  });

  it("discovers a saved organization URL before asking the user for it again", async () => {
    const state = defaultOnboardingState();
    state.productProfile = {
      ...state.productProfile,
      productName: "Saved product name",
      productUrl: "https://closespan.com/",
      productDescription: "Saved product description",
    };
    const discoverCompany = async () => ({
      name: "CloseSpan",
      url: "https://closespan.com/",
      description: null,
      logo: "data:image/png;base64,iVBORw==",
    });

    const initialized = await initializeOnboardingState({
      orgId: "org_test",
      firstName: "Sam",
      existing: state,
      discoverCompany,
    });

    expect(initialized.messages[0]?.content).toBe("Hey, How's it going!");
    expect(initialized.productProfile).toMatchObject({
      productName: "CloseSpan",
      productUrl: "https://closespan.com/",
      productDescription: "Saved product description",
      companyProfileConfirmed: false,
      companyProfileReadyForConfirmation: true,
    });
    expect(
      onboardingGuidanceForWorkspace({
        state: initialized,
        workspaceStatus: emptyWorkspaceStatus,
      }).suggestedReplies,
    ).toEqual([]);
  });

  it("keeps the saved URL and offers manual correction when discovery fails", async () => {
    const state = defaultOnboardingState();
    state.productProfile.productUrl = "https://unavailable.example/";

    const initialized = await initializeOnboardingState({
      orgId: "org_test",
      firstName: "Sam",
      existing: state,
      discoverCompany: async () => {
        throw new Error("unavailable");
      },
    });

    expect(initialized.productProfile.productUrl).toBe(
      "https://unavailable.example/",
    );
    expect(initialized.messages[0]?.content).toBe("Hey, How's it going!");
    expect(initialized.messages[1]?.content).toBe(
      "Site unavailable. Check the URL or describe the company.",
    );
    expect(
      onboardingGuidanceForWorkspace({
        state: initialized,
        workspaceStatus: emptyWorkspaceStatus,
      }).suggestedReplies,
    ).toEqual([]);
  });

  it("does not treat a temporary signup workspace name as discovered company data", () => {
    const state = defaultOnboardingState();
    state.productProfile.productName = "Sam's workspace";

    const guidance = onboardingGuidanceForWorkspace({
      state,
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(guidance.recommendedConnectors).toEqual([]);
    expect(guidance.suggestedActions).toEqual([]);
    expect(guidance.suggestedReplies).toEqual([
      "We don't have a website yet",
    ]);
  });

  it("requires company confirmation before recommending connectors", async () => {
    const state = defaultOnboardingState();
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
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
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(turn.phase).toBe("discover");
    expect(turn.productProfile.productDescription).toBeTruthy();
    expect(turn.productProfile.companyProfileConfirmed).toBe(false);
    expect(turn.productProfile.companyProfileReadyForConfirmation).toBe(true);
    expect(turn.recommendedConnectors).toEqual([]);

    const confirmed = await confirmCompanyProfileTurn({
      orgId: "org_test",
      state: {
        ...state,
        productProfile: turn.productProfile,
      },
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(confirmed.phase).toBe("connect");
    expect(confirmed.productProfile.companyProfileConfirmed).toBe(true);
    expect(confirmed.recommendedConnectors.length).toBeGreaterThan(0);
    expect(
      confirmed.recommendedConnectors.some((item) =>
        ["int_zendesk", "int_slack", "int_intercom"].includes(item.integrationId),
      ),
    ).toBe(true);
    expect(
      confirmed.recommendedConnectors.every((connector) =>
        isIntegrationAvailable(connector.integrationId),
      ),
    ).toBe(true);
    expect(
      confirmed.recommendedConnectors.some((connector) =>
        isFeedbackSourceIntegration(connector.integrationId),
      ),
    ).toBe(true);
  });

  it("recognizes a reported GitHub failure as resolved when GitHub is connected", async () => {
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
      state: connectorState(),
      userMessage: "GitHub failed to connect",
      workspaceStatus: {
        ...emptyWorkspaceStatus,
        connectedIntegrationIds: ["int_github"],
        githubConnected: true,
      },
    });

    expect(turn.assistantMessage).toContain("GitHub is connected");
    expect(turn.assistantMessage).toContain("Zendesk");
    expect(turn.recommendedConnectors.map((item) => item.integrationId)).toContain(
      "int_zendesk",
    );
    expect(turn.recommendedConnectors.map((item) => item.integrationId)).not.toContain(
      "int_github",
    );
    expect(turn.recommendedConnectors.map((item) => item.integrationId)).toContain(
      "int_linear",
    );
    expect(turn.suggestedActions).not.toContainEqual(
      expect.objectContaining({ type: "connect_github" }),
    );
  });

  it("offers webhook fallback when a failed source has no available alternative", async () => {
    const state = connectorState();
    state.recommendedConnectors = state.recommendedConnectors.filter(
      (connector) =>
        ["int_zendesk", "int_linear"].includes(connector.integrationId),
    );
    const turn = await runOnboardingTurn({
      orgId: "org_test",
      firstName: "Sam",
      organizationName: "CloseSpan",
      state,
      userMessage: "Zendesk is broken and cannot connect",
      workspaceStatus: {
        ...emptyWorkspaceStatus,
        connectedIntegrationIds: ["int_github"],
        githubConnected: true,
      },
    });

    expect(turn.assistantMessage).toContain("Zendesk failed");
    expect(turn.recommendedConnectors[0]?.integrationId).toBe("int_webhook");
    expect(turn.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_webhook" }),
    );
    expect(
      turn.recommendedConnectors.every((connector) =>
        isIntegrationAvailable(connector.integrationId),
      ),
    ).toBe(true);
  });

  it("rebuilds reload guidance from authoritative connection state", () => {
    const state = connectorState();
    state.recommendedConnectors.push({
      integrationId: "int_webhook",
      provider: "Custom webhook",
      reason: "Fallback",
      priority: "optional",
      connectionMethod: "webhook",
    });
    const guidance = onboardingGuidanceForWorkspace({
      state,
      workspaceStatus: {
        ...emptyWorkspaceStatus,
        connectedIntegrationIds: ["int_zendesk"],
        feedbackConnected: true,
      },
    });

    expect(guidance.recommendedConnectors.map((item) => item.integrationId)).toContain(
      "int_linear",
    );
    expect(guidance.suggestedActions).not.toContainEqual(
      expect.objectContaining({ integrationId: "int_zendesk" }),
    );
    expect(guidance.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_webhook" }),
    );
    expect(guidance.suggestedReplies).toContain("Connect GitHub");
  });

  it("restores a webhook escape hatch when persisted recommendations are unavailable", () => {
    const state = connectorState();
    state.recommendedConnectors = state.recommendedConnectors.filter(
      (connector) => connector.integrationId === "int_linear",
    );

    const guidance = onboardingGuidanceForWorkspace({
      state,
      workspaceStatus: emptyWorkspaceStatus,
    });

    expect(guidance.recommendedConnectors[0]?.integrationId).toBe(
      "int_webhook",
    );
    expect(guidance.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_webhook" }),
    );
    expect(guidance.suggestedReplies).toContain("Connect GitHub");
  });
});
