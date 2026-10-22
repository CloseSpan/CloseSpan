import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({ useReducedMotion: () => true }));
import { useHydrationSafeReducedMotion } from "./hydration-safe-motion";

function Probe() {
  return <span>{String(useHydrationSafeReducedMotion())}</span>;
}

describe("hydration-safe reduced motion", () => {
  it("reports no preference while rendering on the server, even when the browser prefers reduced motion", () => {
    expect(renderToString(<Probe />)).toContain("false");
  });
});
