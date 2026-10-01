import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceChromeProvider, WorkspacePrimaryActionControl } from "./workspace-chrome";

const state = vi.hoisted(() => ({ pathname: "/settings/appearance" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

function renderAction(pathname: string) {
  state.pathname = pathname;
  return renderToStaticMarkup(<WorkspaceChromeProvider><WorkspacePrimaryActionControl /></WorkspaceChromeProvider>);
}

describe("workspace primary action", () => {
  it("does not offer a workspace-policy save for personal appearance", () => {
    expect(renderAction("/settings/appearance")).toBe("");
  });
  it("preserves Save policy for workspace settings", () => {
    const markup = renderAction("/settings");
    expect(markup).toContain("Save policy");
    expect(markup).toContain('class="btn workspace-primary-action"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('btn primary');
  });
  it("links workspace search to issues without duplicating the issue search field", () => {
    expect(renderAction("/approvals")).toContain('href="/problems"');
    expect(renderAction("/problems")).toBe("");
    expect(renderAction("/settings/technical")).toBe("");
    expect(renderAction("/settings/connections")).toBe("");
  });
});
