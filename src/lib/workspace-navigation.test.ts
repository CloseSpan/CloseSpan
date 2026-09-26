import { describe, expect, it } from "vitest";
import { WORKSPACE_LABELS } from "./workspace-labels";
import {
  WORKSPACE_NAVIGATION,
  workspaceRouteDirection,
  workspaceRouteIndex,
  workspaceSection,
} from "./workspace-navigation";

describe("workspace navigation", () => {
  it("uses the canonical screen name for every navigation label and breadcrumb", () => {
    for (const item of WORKSPACE_NAVIGATION) {
      expect(item.label).toBe(WORKSPACE_LABELS[item.id]);
      expect(workspaceSection(item.href)).toBe(item.label);
    }
  });
  it("restores the production tools alongside workspace settings", () => {
    expect(WORKSPACE_NAVIGATION.map(({ label, href }) => [label, href])).toEqual([
      ["Overview", "/overview"], ["Customers", "/customers"],
      ["Feedback inbox", "/feedback"], ["Issues", "/problems"],
      ["Prompt Testing", "/pdd"], ["Action approvals", "/approvals"],
      ["Agent activity", "/agent-runs"], ["Follow-up", "/follow-up"],
      ["Integrations", "/integrations"], ["Settings", "/settings"],
    ]);
  });
  it("maps every sidebar route to its visual order", () => {
    WORKSPACE_NAVIGATION.forEach(({ href }, index) => {
      expect(workspaceRouteIndex(href)).toBe(index);
    });
  });

  it("maps nested routes to their owning navigation item", () => {
    for (const [route, owner] of [
      ["/problems/problem_123", "/problems"],
      ["/approvals/approval_123", "/approvals"],
      ["/settings/appearance", "/settings"],
      ["/pdd/problem_123", "/pdd"],
      ["/agent-runs/run_123", "/agent-runs"],
    ]) {
      expect(workspaceRouteIndex(route)).toBe(workspaceRouteIndex(owner));
      expect(workspaceRouteIndex(route)).not.toBeNull();
    }
    expect(workspaceRouteIndex("/unknown")).toBeNull();
  });

  it("derives vertical motion from sidebar order", () => {
    expect(workspaceRouteDirection("/problems", "/approvals")).toBe("forward");
    expect(workspaceRouteDirection("/settings", "/problems")).toBe("backward");
    expect(workspaceRouteDirection("/problems", "/problems/problem_123")).toBe(
      "forward",
    );
    expect(workspaceRouteDirection("/problems/problem_123", "/problems")).toBe(
      "backward",
    );
    expect(workspaceRouteDirection(null, "/overview")).toBe("none");
  });

  it("ignores query strings and hashes", () => {
    expect(workspaceRouteDirection("/feedback?source=all", "/feedback#latest")).toBe(
      "none",
    );
  });

  it("provides stable breadcrumb labels", () => {
    expect(workspaceSection("/problems/problem_123")).toBe("Issues");
    expect(workspaceSection("/pdd/problem_123")).toBe(
      "Prompt Testing",
    );
    expect(workspaceSection("/agent-runs/run_123")).toBe(
      "Agent activity",
    );
    expect(workspaceSection("/settings")).toBe("Settings");
    expect(workspaceSection("/settings#members")).toBe("Settings");
    expect(workspaceSection("/settings/appearance")).toBe("Appearance");
    expect(workspaceSection("/settings/appearance?preview=dark")).toBe("Appearance");
    expect(workspaceSection("/integrations")).toBe("Integrations");
    expect(workspaceSection("/admin/users")).toBe("Active users");
    expect(workspaceSection("/admin/waitlist")).toBe("Active users");
  });

  it("keeps administration outside the primary order", () => {
    expect(workspaceRouteIndex("/admin/waitlist")).toBeNull();
    expect(workspaceRouteIndex("/admin/users")).toBeNull();
  });
});
