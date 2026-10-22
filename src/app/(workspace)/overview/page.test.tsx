import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));

import OverviewPage from "./page";

describe("retired overview", () => {
  it("sends old bookmarks to Issues, the workspace home", () => {
    expect(() => OverviewPage()).toThrow("redirect:/problems");
  });
});
