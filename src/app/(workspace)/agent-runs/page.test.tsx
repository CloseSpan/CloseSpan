import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: async () => ({ orgId: "org_a", role: "Admin" }) }));
vi.mock("@/lib/engineering-workflow-repository", () => ({ listAgentRuns: mocks.list }));
vi.mock("@/lib/agent-run-findings-repository", () => ({ readFindingIssueLinks: async () => ({ ready: false, links: {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/agent-run-delete-button", () => ({ AgentRunDeleteButton: () => null }));
import Page from "./page";
const base = { approvalId: null, repository: "org/repo", branchName: "b", pullRequestUrl: null, queuedAt: "2026-10-01T00:00:00Z", completedAt: "2026-10-01T00:01:00Z", independentVerificationStatus: null, finalExecutionStatus: null };
beforeEach(() => { mocks.list.mockResolvedValue([
  { ...base, id: "failed", problemId: "p1", problemTitle: "Broken export", status: "Failed", failureCode: "execution_timeout" },
  { ...base, id: "clean", problemId: "p2", problemTitle: "Healthy import", status: "Draft PR opened", independentVerificationStatus: "passed" },
]); });
describe("Agent Activity findings", () => {
  it("keeps the existing table and adds a compact expandable finding", async () => {
    const html = renderToStaticMarkup(await Page({}));
    expect(html).toContain("Broken export");
    expect(html).toContain("Healthy import");
    expect(html).toContain("Needs attention (1)");
    expect(html).toContain('<details class="agent-finding">');
    expect(html).toContain("Execution timed out");
    expect(html).toContain("Issue creation requires database setup.");
    expect(html).not.toContain(">Create issue</button>");
    expect(mocks.list).toHaveBeenCalledWith("org_a");
  });
  it("filters to unresolved findings without changing the full-list count", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ attention: "1" }) }));
    expect(html).toContain("Broken export");
    expect(html).not.toContain("Healthy import");
    expect(html).toContain("All runs (2)");
  });
  it("distinguishes an empty filter from no execution history", async () => {
    mocks.list.mockResolvedValue([{ ...base, id: "clean", problemId: "p2", problemTitle: "Healthy", status: "Draft PR opened" }]);
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ attention: "1" }) }));
    expect(html).toContain("No runs need attention");
    expect(html).not.toContain("No agent runs yet");
  });
});
