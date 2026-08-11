import { describe, expect, it } from "vitest";
import {
  changedFilesNeedUiVerification,
  compareUiLayouts,
  parseReleaseVerificationPlan,
} from "./release-verification-plan";

describe("sealed UI release verification plans", () => {
  it("uses a bounded responsive smoke plan when PDD instructions are prose", () => {
    const plan = parseReleaseVerificationPlan("Verify the released customer workflow.");
    expect(plan.viewports.map((viewport) => viewport.name)).toEqual(["desktop", "mobile"]);
    expect(plan.journeys).toHaveLength(1);
    expect(plan.journeys[0]?.path).toBe("/");
  });

  it("rejects journeys that can navigate outside the configured origin", () => {
    expect(() => parseReleaseVerificationPlan(`
\`\`\`closespan-ui-verification
{"schemaVersion":1,"kind":"ui","viewports":[{"name":"desktop","width":1440,"height":900}],"journeys":[{"id":"escape","name":"Escape","path":"//attacker.example","actions":[],"assertions":[],"captureScreenshot":true}],"failOnConsoleError":true,"failOnPageError":true,"accessibility":{"requireImageAlt":true,"requireControlNames":true,"requireInputLabels":true},"maxLayoutDifferenceRatio":0.08}
\`\`\`
    `)).toThrow("Journey paths must stay");
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
});
