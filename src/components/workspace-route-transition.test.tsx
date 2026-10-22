import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduce: true as boolean | null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/problems" }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...await importOriginal<typeof import("framer-motion")>(),
  useReducedMotion: () => motion.reduce,
}));

import { WorkspaceRouteTransition } from "./workspace-route-transition";

describe("workspace route transition", () => {
  it("renders the first page settled whatever the motion preference, so hydration matches", () => {
    motion.reduce = null; // server: preference unknown
    const server = renderToString(<WorkspaceRouteTransition><p>Issues</p></WorkspaceRouteTransition>);
    motion.reduce = true; // reduced-motion browser
    const reduced = renderToString(<WorkspaceRouteTransition><p>Issues</p></WorkspaceRouteTransition>);
    expect(server).not.toContain("opacity:0.86");
    expect(server).toBe(reduced);
  });
});
