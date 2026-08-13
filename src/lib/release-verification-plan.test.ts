import { describe, expect, it } from "vitest";
import {
  assessReleaseVerificationScope,
  changedFilesNeedUiVerification,
  classifyReleaseVerificationFile,
  combinedReleaseVerificationPassed,
  compareUiLayouts,
  parseReleaseVerificationPlan,
  releaseVerificationPlanSchema,
} from "./release-verification-plan";

describe("sealed combined release verification plans", () => {
  it("uses bounded backend and responsive frontend smoke checks when Prompt Testing instructions are prose", () => {
    const plan = parseReleaseVerificationPlan("Verify the released customer workflow.");
    expect(plan.requirements).toEqual({ backend: "required", frontend: "required" });
    expect(plan.backend.checks[0]).toMatchObject({ method: "GET", path: "/api/health", expectedStatus: 200 });
    expect(plan.frontend.viewports.map((viewport) => viewport.name)).toEqual(["desktop", "mobile"]);
    expect(plan.frontend.journeys).toHaveLength(1);
    expect(plan.frontend.journeys[0]?.path).toBe("/");
  });

  it("rejects journeys that can navigate outside the configured origin", () => {
    expect(() => parseReleaseVerificationPlan(`
\`\`\`closespan-ui-verification
{"schemaVersion":1,"kind":"ui","viewports":[{"name":"desktop","width":1440,"height":900}],"journeys":[{"id":"escape","name":"Escape","path":"//attacker.example","actions":[],"assertions":[],"captureScreenshot":true}],"failOnConsoleError":true,"failOnPageError":true,"accessibility":{"requireImageAlt":true,"requireControlNames":true,"requireInputLabels":true},"maxLayoutDifferenceRatio":0.08}
\`\`\`
    `)).toThrow("Verification paths must stay");
  });

  it("rejects backend checks that escape the production origin or use mutating methods", () => {
    const invalid = {
      schemaVersion: 2,
      kind: "combined",
      requirements: { backend: "required", frontend: "not_required" },
      backend: { checks: [{
        id: "escape", name: "Escape", method: "POST", path: "//attacker.example",
        authProfile: "none", expectedStatus: 200, maxDurationMs: 5_000, headers: [], json: [],
      }] },
      frontend: parseReleaseVerificationPlan("default").frontend,
    };
    expect(() => parseReleaseVerificationPlan(`\`\`\`closespan-release-verification\n${JSON.stringify(invalid)}\n\`\`\``)).toThrow();
  });

  it("requires every required section to pass before the combined result passes", () => {
    expect(combinedReleaseVerificationPassed({
      schemaVersion: 2,
      backend: { required: true, status: "Passed", checks: [{ passed: true }] },
      frontend: { required: true, status: "Passed", checks: [{ passed: true }] },
    })).toBe(true);
    expect(combinedReleaseVerificationPassed({
      schemaVersion: 2,
      backend: { required: true, status: "Failed", checks: [{ passed: false }] },
      frontend: { required: true, status: "Passed", checks: [{ passed: true }] },
    })).toBe(false);
  });

  it("detects missing and materially shifted approved elements", () => {
    const baseline = [
      { key: "h1:Title:1", text: "Title", x: 20, y: 20, width: 300, height: 40, visible: true },
      { key: "button:Save:1", text: "Save", x: 20, y: 100, width: 120, height: 44, visible: true },
    ];
    const result = compareUiLayouts(baseline, [
      { ...baseline[0]!, x: 400 },
    ]);
    expect(result.differenceRatio).toBeGreaterThan(0.2);
    expect(result.missing).toEqual(["button:Save:1"]);
    expect(result.changed).toEqual(["h1:Title:1"]);
  });

  it("requires UI verification for component and style changes", () => {
    expect(changedFilesNeedUiVerification(["src/components/modal.tsx"])).toBe(true);
    expect(changedFilesNeedUiVerification(["src/app/theme.css"])).toBe(true);
    expect(changedFilesNeedUiVerification(["src/lib/billing.ts"])).toBe(false);
    expect(changedFilesNeedUiVerification(["packages/app/src/export.ts"])).toBe(false);
  });

  it("classifies changed paths conservatively by runtime surface", () => {
    expect(classifyReleaseVerificationFile("src/app/api/orders/route.ts")).toBe("backend");
    expect(classifyReleaseVerificationFile("src/components/order-table.tsx")).toBe("frontend");
    expect(classifyReleaseVerificationFile("db/migrations/048_orders.sql")).toBe("shared");
    expect(classifyReleaseVerificationFile("src/components/order-table.test.tsx")).toBe("neutral");
    expect(classifyReleaseVerificationFile("src/lib/money.ts")).toBe("unknown");
  });

  it("accepts changed files covered by the Prompt Testing and never shrinks its declared scope", () => {
    const both = parseReleaseVerificationPlan("default");
    const assessment = assessReleaseVerificationScope(both, [
      "src/components/order-table.tsx",
      "README.md",
    ]);
    expect(assessment).toMatchObject({
      compatible: true,
      declared: { backend: true, frontend: true },
      observed: { backend: false, frontend: true, unknown: false },
      recommended: { backend: true, frontend: true },
      mismatches: [],
    });
  });

  it("locks final execution when a PR exceeds a single-surface Prompt Testing contract", () => {
    const frontendOnly = releaseVerificationPlanSchema.parse({
      ...parseReleaseVerificationPlan("default"),
      requirements: { backend: "not_required", frontend: "required" },
    });
    const assessment = assessReleaseVerificationScope(frontendOnly, [
      "src/components/order-table.tsx",
      "src/app/api/orders/route.ts",
    ]);
    expect(assessment.compatible).toBe(false);
    expect(assessment.recommended).toEqual({ backend: true, frontend: true });
    expect(assessment.mismatches).toEqual([
      expect.stringContaining("backend production verification is not approved"),
    ]);
  });

  it("requires both surfaces for unknown files unless the Prompt Testing already covers both", () => {
    const backendOnly = releaseVerificationPlanSchema.parse({
      ...parseReleaseVerificationPlan("default"),
      requirements: { backend: "required", frontend: "not_required" },
    });
    expect(assessReleaseVerificationScope(backendOnly, ["src/lib/money.ts"]).compatible).toBe(false);
    expect(assessReleaseVerificationScope(parseReleaseVerificationPlan("default"), ["src/lib/money.ts"]).compatible).toBe(true);
  });
});
