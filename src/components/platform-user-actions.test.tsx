import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformUserActions } from "./platform-user-actions";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }]; },
  useRef: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useEffect: () => {}, useId: () => "test_id",
}));
const fetchMock = vi.fn();
const complete = vi.fn();
let tree: ReactNode;
function render(status: "Active" | "Blocked" = "Active") {
  hooks.index = 0;
  tree = PlatformUserActions({ email: "member@example.com", displayName: "Test Member", status, orgId: "org_live", onComplete: complete });
}
type Props = {
  children?: ReactNode; disabled?: boolean; type?: string;
  onClick?: (event: { currentTarget: HTMLButtonElement }) => void;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
};
function find(node: ReactNode, type: string, text?: string): Props | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (child.type === type && (!text || Children.toArray(child.props.children).includes(text))) return child.props;
    const found = find(child.props.children, type, text); if (found) return found;
  }
}
function click(text: string) { find(tree, "button", text)!.onClick!({ currentTarget: {} as HTMLButtonElement }); render(); }
function submit() { find(tree, "form")!.onSubmit!({ preventDefault() {} }); }
beforeEach(() => { hooks.values = []; fetchMock.mockReset(); complete.mockReset(); vi.stubGlobal("fetch", fetchMock); render(); });
afterEach(() => vi.unstubAllGlobals());

describe("platform user action confirmation", () => {
  it("opening and cancelling a block or delete does not mutate the account", () => {
    click("Block"); expect(find(tree, "button", "Block user")).toBeDefined(); click("Cancel");
    click("Delete"); expect(find(tree, "button", "Delete user")?.disabled).toBe(true); click("Cancel");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires the exact email before deletion can be submitted", async () => {
    click("Delete"); submit(); expect(fetchMock).not.toHaveBeenCalled();
    find(tree, "input")!.onChange!({ target: { value: "wrong@example.com" } }); render(); submit(); expect(fetchMock).not.toHaveBeenCalled();
    find(tree, "input")!.onChange!({ target: { value: "member@example.com" } }); render();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "Deleted" }) });
    expect(find(tree, "button", "Delete user")?.disabled).toBe(false); submit();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ email: "member@example.com", action: "delete", expectedStatus: "Active", confirmationEmail: "member@example.com" }));
  });
  it("locks duplicate submissions and cancel while a request is in flight", async () => {
    let finish!: (result: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    click("Block"); submit(); submit(); render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(find(tree, "button", "Cancel")?.disabled).toBe(true);
    expect(find(tree, "button", "Saving…")?.disabled).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    finish({ ok: true, json: async () => ({ status: "Blocked" }) });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("Test Member is now blocked."));
  });
  it("retains typed confirmation after failure and reuses the request key for retries", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Assign another active admin first." }) });
    click("Delete"); find(tree, "input")!.onChange!({ target: { value: "member@example.com" } }); render(); submit();
    await vi.waitFor(() => { render(); expect(JSON.stringify(tree)).toContain("Assign another active admin first."); });
    expect(find(tree, "button", "Delete user")?.disabled).toBe(false);
    expect(complete).not.toHaveBeenCalled(); submit();
    expect(fetchMock.mock.calls[0][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[1][1].headers["idempotency-key"]);
  });
  it("offers unblock for blocked users", () => { render("Blocked"); expect(find(tree, "button", "Unblock")).toBeDefined(); expect(find(tree, "button", "Block")).toBeUndefined(); });
});
