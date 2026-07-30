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
    expect(workspaceRouteIndex("/problems/problem_123")).toBe(2);
    expect(workspaceRouteIndex("/agent-runs/run_123")).toBe(5);
    expect(workspaceRouteIndex("/unknown")).toBeNull();
  });

  it("derives vertical motion from sidebar order", () => {
    expect(workspaceRouteDirection("/overview", "/approvals")).toBe("forward");
    expect(workspaceRouteDirection("/settings", "/problems")).toBe("backward");
    expect(workspaceRouteDirection("/problems", "/problems/problem_123")).toBe(
      "none",
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
    expect(workspaceSection("/agent-runs/run_123")).toBe("Agent run results");
  });
});
