import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production owner provisioning defaults", () => {
  it("creates new workspaces in Execute with approval without overwriting an existing choice", async () => {
    const script = await readFile(
      path.join(process.cwd(), "scripts/provision-owner.mjs"),
      "utf8",
    );

    expect(script).toContain("$1, 'Execute with approval', true, 365");
    expect(script).not.toContain("autonomy_level = excluded.autonomy_level");
  });
});
