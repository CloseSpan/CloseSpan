import { createHash } from "node:crypto";
import type { TenkiRuntimeEnvironment } from "./tenki-runtime-environment";
import {
  hashReleaseVerificationPlan,
  parseReleaseVerificationPlan,
  type UiVerificationBaseline,
} from "./release-verification-plan";

export async function captureTenkiUiBaseline(
  runtime: Pick<TenkiRuntimeEnvironment, "browser">,
  instructions: string,
): Promise<UiVerificationBaseline> {
  const plan = parseReleaseVerificationPlan(instructions);
  const captures: UiVerificationBaseline["captures"] = [];
  for (const journey of plan.journeys) {
    for (const viewport of plan.viewports) {
      const result = await runtime.browser({
        path: journey.path,
        actions: journey.actions,
        assertions: journey.assertions,
        viewport,
        captureScreenshot: journey.captureScreenshot,
        accessibility: plan.accessibility,
      });
      if (result.screenshotBase64 && result.screenshotBase64.length > 450_000)
        throw new Error(`UI baseline screenshot ${journey.id}/${viewport.name} exceeds 450 KB`);
      captures.push({
        key: `${journey.id}:${viewport.name}`,
        journeyId: journey.id,
        viewport,
        url: result.url,
        title: result.title,
        screenshotBase64: result.screenshotBase64,
        screenshotSha256: result.screenshotBase64
          ? createHash("sha256").update(result.screenshotBase64, "utf8").digest("hex")
          : null,
        layout: result.layout,
        consoleErrors: result.consoleErrors,
        pageErrors: result.pageErrors,
        accessibilityViolations: result.accessibilityViolations,
        assertionFailures: result.assertionFailures,
      });
    }
  }
  return {
    schemaVersion: 1,
    planHash: hashReleaseVerificationPlan(plan),
    headSha: null,
    capturedAt: new Date().toISOString(),
    captures,
  };
}

export function uiBaselinePassed(
  baseline: UiVerificationBaseline | undefined,
  instructions: string,
): boolean {
  if (!baseline) return true;
  const plan = parseReleaseVerificationPlan(instructions);
  return baseline.captures.every((capture) =>
    capture.assertionFailures.length === 0
    && (!plan.failOnConsoleError || capture.consoleErrors.length === 0)
    && (!plan.failOnPageError || capture.pageErrors.length === 0)
    && capture.accessibilityViolations.length === 0,
  );
}
