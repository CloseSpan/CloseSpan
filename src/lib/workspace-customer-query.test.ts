import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace customer query", () => {
  async function repositorySource(): Promise<string> {
    return readFile(
      path.join(process.cwd(), "src/lib/workspace-repository.ts"),
      "utf8",
    );
  }

  it("uses immutable account links and excludes closed problems", async () => {
    const source = await repositorySource();

    expect(source).toContain("feedback.account_id=a.id");
    expect(source).toContain("account_impact.account_id=a.id");
    expect(source).toContain("problem.stage <> 'Closed'");
    expect(source).not.toContain("f.customer_name=a.name");
  });

  it("replaces demo accounts only after a real account exists", async () => {
    const source = await repositorySource();

    expect(source).toContain("a.origin <> 'demo'");
    expect(source).toContain("live_account.origin <> 'demo'");
    expect(source).toContain("OR NOT EXISTS");
  });

  it("returns source provenance and orders unknown ARR last", async () => {
    const source = await repositorySource();

    expect(source).toContain("integration.provider");
    expect(source).toContain("account_source_links source_link");
    expect(source).toContain("ORDER BY (a.arr_source='unknown')");
  });
});
