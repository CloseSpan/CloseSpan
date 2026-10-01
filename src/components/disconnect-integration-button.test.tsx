import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisconnectIntegrationButton } from "./disconnect-integration-button";

// Component state only: these tests never contact an actual provider or workspace.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));
const fetchMock = vi.fn();
const disconnected = vi.fn();
let tree: ReactNode;
function render() {
  hooks.index = 0;
  tree = DisconnectIntegrationButton({ orgId: "org_alpha", provider: "GitHub", endpoint: "/api/integrations/github", onDisconnected: disconnected });
}
type Control = { children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string };
function find(node: ReactNode, text: string): Control | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Control>(child)) continue;
    if (child.type === "button" && Children.toArray(child.props.children).some((part) => part === text)) return child.props;
    const result = find(child.props.children, text);
    if (result) return result;
  }
}
beforeEach(() => {
  hooks.values = []; fetchMock.mockReset(); disconnected.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  render();
});
afterEach(() => vi.unstubAllGlobals());

describe("disconnect confirmation", () => {
  it("opening and cancelling confirmation never sends a request", () => {
    find(tree, "Disconnect ")!.onClick!(); render();
    expect(find(tree, "Confirm disconnect")).toBeDefined();
    find(tree, "Cancel")!.onClick!(); render();
    expect(find(tree, "Confirm disconnect")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("guards duplicate submissions and reports success only after the server succeeds", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    find(tree, "Disconnect ")!.onClick!(); render();
    const confirm = find(tree, "Confirm disconnect")!.onClick!;
    confirm(); confirm(); render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(find(tree, "Disconnecting…")?.disabled).toBe(true);
    expect(disconnected).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/integrations/github", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "x-org-id": "org_alpha" }) }));
    finish({ ok: true, json: async () => ({ disconnected: true }) });
    await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
  });
  it("keeps the connection on a failed request and permits retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Try again" }) });
    find(tree, "Disconnect ")!.onClick!(); render();
    find(tree, "Confirm disconnect")!.onClick!();
    await vi.waitFor(() => {
      render();
      expect(find(tree, "Confirm disconnect")?.disabled).toBe(false);
    });
    expect(disconnected).not.toHaveBeenCalled();
    expect(JSON.stringify(tree)).toContain("Try again");
  });
});
