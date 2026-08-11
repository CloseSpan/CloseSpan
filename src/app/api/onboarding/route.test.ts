import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({
  state: null as unknown,
  setup: null as unknown,
  save: vi.fn(),
  rename: vi.fn(),
  discoverCompany: vi.fn(),
}));

vi.mock("@/lib/company-profile-discovery", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/company-profile-discovery")
  >();
  return {
    ...actual,
    discoverCompanyProfile: repository.discoverCompany,
  };
});

vi.mock("@/lib/auth-user", () => ({
  displayFirstName: (name: string) => name.trim().split(/\s+/)[0] || "there",
}));

vi.mock("@/lib/onboarding-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/onboarding-repository")
  >();
  return {
    ...actual,
    getOnboardingState: vi.fn(async () => repository.state),
    saveOnboardingState: repository.save,
  };
});

vi.mock("@/lib/integration-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/integration-repository")
  >();
  return {
    ...actual,
    getWorkspaceSetupStatus: vi.fn(async () => repository.setup),
  };
});

vi.mock("@/lib/organization-repository", () => ({
  renameOrganization: repository.rename,
}));

import { GET, PATCH, POST } from "./route";
import type { WorkspaceSetupStatus } from "@/lib/integration-repository";
import type { OnboardingState } from "@/lib/onboarding-repository";

function request(
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  role = "Contributor",
) {
  return new NextRequest("http://localhost/api/onboarding", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": `onboarding_${crypto.randomUUID()}`,
      "x-org-id": "org_alpha",
      "x-request-id": crypto.randomUUID(),
      "x-test-user-id": "user_alpha",
      "x-test-user-org-id": "org_alpha",
      "x-test-user-name": "Sam Operator",
      "x-test-user-email": "sam@example.com",
      "x-test-organization-name": "CloseSpan",
      "x-test-user-role": role,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function state(): OnboardingState {
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
        integrationId: "int_zendesk",
        provider: "Zendesk",
        reason: "Support feedback",
        priority: "required",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_linear",
        provider: "Linear",
        reason: "Unavailable connector",
        priority: "optional",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_webhook",
        provider: "Custom webhook",
        reason: "Fallback",
        priority: "optional",
        connectionMethod: "webhook",
      },
    ],
    messages: [
      { role: "assistant", content: "Connect sources", at: "2026-07-20T10:00:00Z" },
      { role: "user", content: "Show options", at: "2026-07-20T10:01:00Z" },
    ],
  };
}

function setup(): WorkspaceSetupStatus {
  return {
    feedbackConnected: true,
    aiConfigured: true,
    githubConnected: false,
    feedbackCount: 0,
    setupComplete: false,
    connectedIntegrationIds: ["int_zendesk"],
  };
}

describe("onboarding route workspace reconciliation", () => {
  beforeEach(() => {
    process.env.PERSISTENCE_MODE = "memory";
    process.env.APP_MODE = "demo";
    repository.state = state();
    repository.setup = setup();
    repository.save.mockReset();
    repository.rename.mockReset();
    repository.rename.mockResolvedValue({
      organizationId: "org_alpha",
      organizationName: "Northstar",
    });
    repository.discoverCompany.mockReset();
    repository.save.mockImplementation(async (_orgId, nextState) => {
      repository.state = structuredClone(nextState);
    });
  });

  it("rebuilds GET actions from current connections and includes available Pipedream connectors", async () => {
    const response = await GET(request("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recommendedConnectors.map((item: { integrationId: string }) => item.integrationId))
      .toEqual(["int_github", "int_zendesk", "int_linear", "int_webhook"]);
    expect(body.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_github" }),
    );
    expect(body.suggestedActions).toContainEqual(
      expect.objectContaining({ type: "connect_webhook" }),
    );
    expect(body.suggestedActions).not.toContainEqual(
      expect.objectContaining({ integrationId: "int_zendesk" }),
    );
    expect(body.workspaceStatus.connectedIntegrationIds).toEqual([
      "int_zendesk",
    ]);
    expect(body.userEmail).toBe("sam@example.com");
  });

  it("discovers and persists the product URL saved during organization creation", async () => {
    repository.state = {
      phase: "discover",
      productProfile: {
        productName: "CloseSpan",
        productUrl: "https://closespan.com/",
        productDescription: "Customer feedback operations software",
        companyLogo: null,
        companyProfileConfirmed: false,
        companyProfileReadyForConfirmation: false,
        feedbackSources: [],
        engineeringTools: [],
      },
      recommendedConnectors: [],
      messages: [],
    } satisfies OnboardingState;
    repository.setup = { ...setup(), feedbackConnected: false };
    repository.discoverCompany.mockResolvedValue({
      name: "CloseSpan",
      url: "https://closespan.com/",
      description: "Close customer feedback loops with verified execution.",
      logo: "data:image/png;base64,iVBORw==",
    });

    const response = await GET(request("GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.discoverCompany).toHaveBeenCalledWith(
      "https://closespan.com/",
    );
    expect(body.productProfile).toMatchObject({
      productName: "CloseSpan",
      productUrl: "https://closespan.com/",
      companyProfileReadyForConfirmation: true,
      companyProfileConfirmed: false,
    });
    expect(body.messages[0].content).toBe("Hey, How's it going!");
    expect(body.suggestedReplies).toEqual([]);
    expect(repository.save).toHaveBeenCalledWith(
      "org_alpha",
      expect.objectContaining({
        productProfile: expect.objectContaining({
          companyProfileReadyForConfirmation: true,
        }),
      }),
    );
  });

  it("passes authoritative GitHub status into a failure turn", async () => {
    const current = state();
    current.recommendedConnectors.unshift({
      integrationId: "int_github",
      provider: "GitHub",
      reason: "Engineering handoff",
      priority: "recommended",
      connectionMethod: "oauth",
    });
    repository.state = current;
    repository.setup = {
      ...setup(),
      githubConnected: true,
      connectedIntegrationIds: ["int_zendesk", "int_github"],
      setupComplete: true,
    } satisfies WorkspaceSetupStatus;

    const response = await POST(
      request("POST", { message: "GitHub failed to connect" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages.at(-1).content).toContain("GitHub is connected");
    expect(body.suggestedActions).not.toContainEqual(
      expect.objectContaining({ type: "connect_github" }),
    );
  });

  it("completes idempotently without rewriting historical messages or setup facts", async () => {
    const originalMessages = structuredClone(state().messages);
    const first = await PATCH(request("PATCH", { action: "continue" }));
    const second = await PATCH(request("PATCH", { action: "continue" }));
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.phase).toBe("complete");
    expect(secondBody.phase).toBe("complete");
    expect(secondBody.messages).toEqual(originalMessages);
    expect(secondBody.workspaceStatus).toEqual(
      expect.objectContaining({
        feedbackConnected: true,
        githubConnected: false,
      }),
    );
  });

  it("confirms company details, renames the first workspace, and opens connector setup", async () => {
    const candidate = state();
    candidate.phase = "discover";
    candidate.productProfile.companyProfileConfirmed = false;
    candidate.productProfile.companyProfileReadyForConfirmation = true;
    candidate.productProfile.companyLogo = "data:image/png;base64,iVBORw==";
    candidate.recommendedConnectors = [];
    repository.state = candidate;
    repository.setup = { ...setup(), feedbackConnected: false };

    const response = await PATCH(
      request("PATCH", { action: "confirm_company" }, "Admin"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.phase).toBe("connect");
    expect(body.productProfile.companyProfileConfirmed).toBe(true);
    expect(body.organizationName).toBe("Northstar");
    expect(body.recommendedConnectors.length).toBeGreaterThan(0);
    expect(body.messages.slice(-2)).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Confirmed Northstar",
      }),
      expect.objectContaining({
        role: "assistant",
      }),
    ]);
    expect(repository.rename).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_alpha",
      name: "Northstar",
    }));
    expect(repository.save).toHaveBeenCalledWith(
      "org_alpha",
      expect.objectContaining({
        productProfile: expect.objectContaining({
          companyProfileConfirmed: true,
        }),
      }),
    );
  });
});
