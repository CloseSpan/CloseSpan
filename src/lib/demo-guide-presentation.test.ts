import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorkspaceGuide, getWorkspaceDemoGuide } from "./demo-guide-repository";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }), transaction: vi.fn() }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));

describe("read-only presentation guide", () => {
  beforeEach(() => { mocks.query.mockReset(); mocks.mode.mockReturnValue("postgres"); });

  it.each([true, false])("includes the existing tenant marker in the guide query: %s", async (readOnly) => {
    mocks.query.mockResolvedValue({ rows: [{ title: "Demo", description: "Sample workflow", steps: demoWorkspaceGuide.steps, read_only: readOnly }] });
    expect(await getWorkspaceDemoGuide("org_sample")).toMatchObject({ readOnly });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("onboarding.product_profile->>'demoMode'='presentation'"), ["org_sample"]);
    expect(mocks.query.mock.calls[0][0]).toContain("onboarding.org_id=guide.org_id");
  });

  it("preserves the resettable legacy memory guide", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await getWorkspaceDemoGuide("org_memory")).toBe(demoWorkspaceGuide);
    expect(demoWorkspaceGuide.readOnly).not.toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("hides the reset control and guards reset without changing guide navigation", () => {
    const component = readFileSync(new URL("../components/guided-demo.tsx", import.meta.url), "utf8");
    expect(component).toContain('!guide.readOnly && <div className="guided-demo-reset">');
    expect(component).toContain("if (guide.readOnly || resetting) return;");
    expect(component).toContain("onClick={() => selectStep(stepIndex - 1)}");
    expect(component).toContain("onClick={() => selectStep(stepIndex + 1)}");
    expect(component).toContain('aria-label="Close guided demo"');
  });
});
