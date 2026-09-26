import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// Provisioning scripts are intentionally plain Node modules, not application code.
// @ts-expect-error No declaration file is needed for the standalone seed module.
import { provisionPresentationWorkflow, presentationGuideSteps } from "../../scripts/presentation-demo-data.mjs";

const problemIds = ["export", "billing", "sso", "mobile", "permissions", "import", "notifications", "search"];

describe("presentation seed safety", () => {
  it("populates complete synthetic workflows without runnable jobs or credentials", async () => {
    const inserts: Array<{ table: string; data: Record<string, unknown> }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      const match = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/);
      if (match) inserts.push({ table: match[1], data: Object.fromEntries(match[2].split(",").map((column, index) => [column, values[index]])) });
      return { rows: [{ unsafe_records: "0" }] };
    });
    const result = await provisionPresentationWorkflow({ query }, {
      orgId: "org_demo_test", memberId: "user_demo", now: new Date("2026-09-12T20:00:00Z"), feedback: [],
      problems: problemIds.map((id) => ({ id: `prob_demo_${id}`, title: `${id} scenario`, statement: `${id} reported behavior`, summary: "Sample report", severity: "Medium", confidence: 0.9, productArea: "Product", team: "Product", repository: `northstar/${id}`, files: [`src/${id}.ts`] })),
    });
    expect(result.requirementReviews).toBe(2);
    expect(result.sampleRuns).toHaveLength(5);
    expect(inserts.filter(({ table }) => table === "engineering_ticket_specifications")).toHaveLength(8);
    expect(inserts.filter(({ table }) => table === "problem_prompt_reviews")).toHaveLength(8);
    for (const { table, data } of inserts) {
      expect(data.org_id).toBe("org_demo_test");
      if (["agent_runs", "final_execution_attempts", "pdd_prompt_verifications", "problem_prompt_reviews"].includes(table)) {
        expect(["Queued", "Running", "Testing", "Generating tests", "Confirmed", "Preparing tests"]).not.toContain(data.status);
      }
      if (table === "approval_requests") expect(data.allowed_capabilities).toBe("[]");
      if (table === "agent_runs") {
        expect(data.pull_request_url).toBeNull();
        expect(JSON.parse(data.implementation_report as string).summary).toMatch(/^Sample result:/);
      }
    }
    expect(query.mock.calls.some(([sql]) => sql.includes("autonomy_level='Observe',monthly_model_budget=0"))).toBe(true);
    expect(presentationGuideSteps).toHaveLength(7);
    expect(presentationGuideSteps.every((step: { path: string }) => /^\/(problems|approvals)/.test(step.path))).toBe(true);
  });

  it("rolls back provisioning if an executable record is detected", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ unsafe_records: "1" }] })) };
    await expect(provisionPresentationWorkflow(client, { orgId: "org_demo_test", memberId: "user_demo", problems: [], feedback: [], now: new Date() })).rejects.toThrow("no executable jobs or live connections");
  });

  it("refuses to reuse an existing workspace for the presentation profile", () => {
    const source = readFileSync(new URL("../../scripts/provision-demo.mjs", import.meta.url), "utf8");
    expect(source).toContain("isPresentationDemo && (!createOrganization || existingOrganization)");
    expect(source.indexOf("Presentation demos must use --create")).toBeLessThan(source.indexOf("DELETE FROM organizations"));
    expect(source).toContain("await client.query(\"ROLLBACK\")");
  });
});
