import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceSettings } from "@/lib/workspace-repository";
import type { OrchestrationProviderPublicConfiguration } from "@/lib/orchestration-provider-repository";
import { SettingsScreen } from "./settings-screen";
import { PageTitle } from "./screens";

vi.mock("./workspace-chrome", () => ({ useWorkspaceChrome: () => ({ setPrimaryAction: vi.fn(), clearPrimaryAction: vi.fn() }) }));
vi.mock("./execution-profile-settings", () => ({ ExecutionProfileSettings: () => <span>Execution profiles</span> }));

const settings = createDefaultWorkspaceSettings({
  provider: "openai", providerLabel: "OpenAI", model: "test-model", configured: true,
  credentialStored: true, vaultConfigured: true, keyHint: null, keySource: "database",
  connectionStatus: "Configured", updatedAt: null, promptVersion: "v1", lastRunStatus: null, lastRunAt: null,
});
const orchestration: OrchestrationProviderPublicConfiguration = {
  activeProvider: "pipedream", providerLabel: "Pipedream", vaultConfigured: true, updatedAt: null,
  n8n: { baseUrl: "", triggerUrl: "", configured: false, apiKeyStored: false, apiKeyHint: null,
    apiKeySource: "none", signingSecretStored: false, signingSecretHint: null, signingSecretSource: "none",
    connectionStatus: "Not configured", lastVerifiedAt: null, lastErrorCode: null },
};
function renderSettings(overrides: Partial<typeof settings> = {}, userRole = "Admin") {
  return renderToStaticMarkup(<SettingsScreen settings={{ ...settings, ...overrides }} orgId="org-test"
    userRole={userRole} tenkiConfigured createosConfigured promptEmailConfigured={false} orchestration={orchestration} />);
}

describe("Concise workspace copy", () => {
  it("shows one fixed minimum report and adjustable confidence defaulting to 65%", () => {
    const markup = renderSettings({ promptDraftPolicy: { ...settings.promptDraftPolicy, mode: "automatic", minimumEvidence: 20 } });
    expect(markup).toContain('<span>Minimum reports</span><strong>1</strong>');
    expect(markup).not.toContain('max="20"');
    expect(markup).toMatch(/<input[^>]*type="range"[^>]*min="50"[^>]*value="65"/);
    expect(markup).toContain('<strong>65%</strong>');
    expect(renderSettings({ promptDraftPolicy: { ...settings.promptDraftPolicy, minimumConfidence: 0.85 } })).toContain('<strong>85%</strong>');
  });
  it("defaults the reviewer to an admin while preserving an explicit selection", () => {
    const members = [
      { id: "member", name: "Morgan", email: "morgan@example.com", role: "Member", team: "Product" },
      { id: "admin", name: "Sam", email: "sam@example.com", role: "Admin", team: "Product" },
    ];
    expect(createDefaultWorkspaceSettings(settings.ai, members).promptDraftPolicy.reviewerId).toBe("admin");
    const markup = renderSettings({ members, promptDraftPolicy: { ...settings.promptDraftPolicy, mode: "automatic" } });
    const reviewerButton = markup.match(/<button[^>]*aria-label="Prompt draft reviewer:[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(reviewerButton).toContain("Sam · Admin");
    expect(reviewerButton).not.toContain('disabled=""');
    const selected = renderSettings({ members, promptDraftPolicy: { ...settings.promptDraftPolicy, reviewerId: "member" } });
    expect(selected.match(/<button[^>]*aria-label="Prompt draft reviewer:[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0]).toContain("Morgan · Member");
  });
  it("renders page names and actions without subtitle markup", () => {
    const markup = renderToStaticMarkup(<PageTitle title="Settings" action={<button>Save policy</button>} />);
    expect(markup).toContain("<h1>Settings</h1>");
    expect(markup).toContain("Save policy");
    expect(markup).not.toContain("<p");
  });

  it("keeps settings labels and controls without explanatory blocks", () => {
    const markup = renderSettings();
    for (const label of ["Prompt drafting", "Bug reports", "Feature requests", "Minimum reports", "Confidence", "Assigned reviewer", "In-app notification", "Email alert"]) {
      expect(markup).toContain(label);
    }
    for (const copy of ["Define permissions", "Choose when the agent", "Drafts cannot execute code", "Draft a suggested fix", "Draft a product-change prompt", "Add the prompt to", "Default policy for", "Execution boundary", "Applies to new evaluations"]) {
      expect(markup).not.toContain(copy);
    }
    expect(markup).toContain('type="range"');
    expect(markup).toContain('type="checkbox"');
  });

  it.each(["Full autonomy", "Automatic coding, human merge"] as const)("requires human merge consent for %s and preserves configuration errors", (autonomyLevel) => {
    const markup = renderSettings({ autonomyLevel, promptDraftPolicy: { ...settings.promptDraftPolicy, emailNotifications: true } });
    expect(markup).toContain("Agent codes automatically. You approve merges.");
    expect(markup).toContain("I authorize automatic coding in approved repositories with workspace budget checks");
    expect(markup).not.toContain("permits automatic merge or deployment");
    expect(markup).toContain("Email delivery needs configuration");
    expect(markup).toContain('role="status"');
  });

  it("preserves the read-only boundary for non-admins", () => {
    const markup = renderSettings({}, "Member");
    expect(markup).toContain("Read-only settings");
    expect(markup).toContain('disabled=""');
  });
});
