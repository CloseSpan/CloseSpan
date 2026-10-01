import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceSettings } from "@/lib/workspace-repository";
import { SettingsScreen } from "./settings-screen";
import type { WorkspacePrimaryAction } from "./workspace-chrome";

// Exercise this component's state/effects without mounting unrelated settings
// providers, contacting a backend, or changing a real workspace policy.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, effects: [] as Array<() => unknown>,
  action: null as WorkspacePrimaryAction | null,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock("./workspace-chrome", () => ({
  useWorkspaceChrome: () => ({
    setPrimaryAction: (action: WorkspacePrimaryAction) => { hooks.action = action; },
    clearPrimaryAction: vi.fn(),
  }),
}));

const settings = createDefaultWorkspaceSettings({
  provider: "openai", providerLabel: "OpenAI", model: "test-model", configured: true,
  credentialStored: true, vaultConfigured: true, keyHint: null, keySource: "database",
  connectionStatus: "Configured", updatedAt: null, promptVersion: "v1", lastRunStatus: null, lastRunAt: null,
});
const props: Parameters<typeof SettingsScreen>[0] = {
  settings, orgId: "org-test", userRole: "Admin", tenkiConfigured: false,
  createosConfigured: false, promptEmailConfigured: false,
  orchestration: {
    activeProvider: "pipedream", providerLabel: "Pipedream", vaultConfigured: true, updatedAt: null,
    n8n: { baseUrl: "", triggerUrl: "", configured: false, apiKeyStored: false, apiKeyHint: null,
      apiKeySource: "none", signingSecretStored: false, signingSecretHint: null, signingSecretSource: "none",
      connectionStatus: "Not configured", lastVerifiedAt: null, lastErrorCode: null },
  },
};
const fetchMock = vi.fn();
let tree: ReactNode;
function render(overrides: Partial<typeof props> = {}) {
  hooks.index = 0;
  hooks.effects = [];
  tree = SettingsScreen({ ...props, ...overrides });
  hooks.effects.forEach((effect) => effect());
  return hooks.action!;
}
type ControlProps = { ariaLabel?: string; children?: ReactNode; disabled?: boolean; onValueChange?: (value: string) => void };
function findControl(node: ReactNode, label: string): ReactElement<ControlProps> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ControlProps>(child)) continue;
    if (child.props.ariaLabel === label) return child;
    const match = findControl(child.props.children, label);
    if (match) return match;
  }
}
function retention(value: string) {
  findControl(tree, "Feedback retention")!.props.onValueChange!(value);
  return render();
}

beforeEach(() => {
  hooks.values = [];
  hooks.action = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Save policy state", () => {
  it("starts disabled, enables an edit, and disables a reverted edit", () => {
    expect(render()).toMatchObject({ disabled: true, disabledReason: "No unsaved changes." });
    hooks.action!.onTrigger();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(retention("90 days").disabled).toBe(false);
    expect(retention("365 days").disabled).toBe(true);
  });

  it("uses displayed defaults as the baseline without a false dirty state", () => {
    expect(render({ settings: { ...settings,
      members: [{ id: "admin", name: "Admin", role: "Admin", email: "admin@example.com", team: "Product" }],
      promptDraftPolicy: { ...settings.promptDraftPolicy, reviewerId: null, minimumEvidence: 20 },
    } }).disabledReason).toBe("No unsaved changes.");
  });

  it("disables during save, prevents duplicate requests, and resets after success", async () => {
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render();
    retention("90 days");
    hooks.action!.onTrigger();
    hooks.action!.onTrigger();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(render().pending).toBe(true);
    expect(findControl(tree, "Feedback retention")!.props.disabled).toBe(true);
    const submitted = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(submitted.retentionDays).toBe(90);
    finish({ ok: true, json: async () => ({ policy: { ...submitted,
      promptDraftPolicy: { ...submitted.promptDraftPolicy, minimumConfidence: 0.7 },
    } }) });
    await vi.waitFor(() => expect(render()).toMatchObject({ pending: false, disabled: true, disabledReason: "No unsaved changes." }));
    expect(retention("365 days").disabled).toBe(false);
    expect(retention("90 days").disabled).toBe(true);
  });

  it.each(["http", "network"])("preserves unsaved edits after a %s failure", async (failure) => {
    if (failure === "network") fetchMock.mockRejectedValue(new Error("Offline"));
    else fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Try again" }) });
    render();
    retention("90 days");
    hooks.action!.onTrigger();
    await vi.waitFor(() => expect(render()).toMatchObject({ pending: false, disabled: false }));
    expect(retention("365 days").disabled).toBe(true);
  });

  it("keeps permission and invalid-input guards on the save handler", () => {
    expect(render({ userRole: "Member" }).disabledReason).toContain("Only workspace admins");
    hooks.action!.onTrigger();
    render();
    retention("90 days");
    expect(retention("Custom policy").disabledReason).toContain("valid feedback-retention");
    hooks.action!.onTrigger();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
