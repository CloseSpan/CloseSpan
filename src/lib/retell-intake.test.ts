import { beforeEach, describe, expect, it, vi } from "vitest";
const analyze = vi.hoisted(() => vi.fn());
vi.mock("./slack-intake", () => ({ analyzeAndClusterSlackSignals: analyze }));
import { analyzeRetellFeedback } from "./retell-intake";
beforeEach(() => { vi.restoreAllMocks(); analyze.mockReset(); });
describe("Retell background analysis", () => {
  it("restricts the existing classifier to Retell feedback in this workspace", async () => {
    analyze.mockResolvedValue({ analyzed: 2, clustered: 1 });
    await expect(analyzeRetellFeedback("org_one")).resolves.toEqual({ analyzed: 2, clustered: 1 });
    expect(analyze).toHaveBeenCalledExactlyOnceWith("org_one", "retell");
  });
  it("keeps imported feedback available without exposing sensitive provider errors", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    analyze.mockRejectedValue(new Error("secret-token and private conversation"));
    await expect(analyzeRetellFeedback("org_one")).resolves.toEqual({ analyzed: 0, clustered: 0 });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-token");
  });
});
