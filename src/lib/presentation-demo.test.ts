import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPresentationDemo } from "./presentation-demo";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));

describe("presentation demo boundary", () => {
  beforeEach(() => { mocks.query.mockReset(); mocks.mode.mockReturnValue("postgres"); });

  it("requires the exact marker in the requested workspace", async () => {
    mocks.query.mockResolvedValue({ rows: [{ demo_mode: "presentation" }] });
    expect(await readPresentationDemo("org_demo_one")).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("WHERE org_id=$1"), ["org_demo_one"]);
  });

  it.each([{ rows: [] }, { rows: [{ demo_mode: null }] }, { rows: [{ demo_mode: "true" }] }, { rows: [{ demo_mode: "Demo" }] }])("defaults unmarked workspaces to ordinary behavior", async ({ rows }) => {
    mocks.query.mockResolvedValue({ rows });
    expect(await readPresentationDemo("org_name_contains_demo")).toBe(false);
  });

  it("does not query the database for legacy memory mode", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await readPresentationDemo("org_memory")).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not silently treat an unavailable database as a live workspace", async () => {
    mocks.query.mockRejectedValue(new Error("Database unavailable"));
    await expect(readPresentationDemo("org_demo_one")).rejects.toThrow("Database unavailable");
  });
});
