import { describe, expect, it } from "vitest";
import {
  WORKSPACE_NAVIGATION,
  workspaceRouteDirection,
  workspaceRouteIndex,
  workspaceSection,
} from "./workspace-navigation";

describe("workspace navigation", () => {
  it("maps every sidebar route to its visual order", () => {
    WORKSPACE_NAVIGATION.forEach(({ href }, index) => {
      expect(workspaceRouteIndex(href)).toBe(index);
    });
  });

  it("maps nested routes to their owning navigation item", () => {
    expect(workspaceRouteIndex("/problems/problem_123")).toBe(3);
    expect(workspaceRouteIndex("/agent-runs/run_123")).toBe(7);
    expect(workspaceRouteIndex("/unknown")).toBeNull();
  });

  it("derives vertical motion from sidebar order", () => {
    expect(workspaceRouteDirection("/overview", "/approvals")).toBe("forward");
    expect(workspaceRouteDirection("/follow-up", "/problems")).toBe("backward");
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
    expect(workspaceSection("/problems/problem_123")).toBe("Product problems");
    expect(workspaceSection("/agent-runs/run_123")).toBe(
      "Agent runs & verification",
    );
    expect(workspaceSection("/settings")).toBe("Settings & governance");
    expect(workspaceSection("/integrations")).toBe("Integrations");
    expect(workspaceSection("/admin/waitlist")).toBe("Waitlist users");
  });

  it("keeps account and administration routes outside the workflow order", () => {
    expect(workspaceRouteIndex("/settings")).toBeNull();
    expect(workspaceRouteIndex("/integrations")).toBeNull();
    expect(workspaceRouteIndex("/admin/waitlist")).toBeNull();
  });
});
