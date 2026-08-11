import { createHash } from "node:crypto";
import { z } from "zod";

const selector = z.string().trim().min(1).max(500).refine(
  (value) => !/[\r\n\0]/.test(value),
  "Selectors may not contain control characters",
);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector }).strict(),
  z.object({ type: z.literal("fill"), selector, value: z.string().max(2_000) }).strict(),
  z.object({ type: z.literal("press"), selector, key: z.string().min(1).max(50) }).strict(),
]);

const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("visible"), selector }).strict(),
  z.object({ type: z.literal("hidden"), selector }).strict(),
  z.object({ type: z.literal("text"), selector, value: z.string().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal("url"), value: z.string().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal("count"), selector, value: z.number().int().min(0).max(10_000) }).strict(),
]);

const viewportSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,30}$/),
  width: z.number().int().min(320).max(3_840),
  height: z.number().int().min(480).max(2_160),
}).strict();

export const releaseVerificationPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ui"),
  viewports: z.array(viewportSchema).min(1).max(6),
  journeys: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
    name: z.string().trim().min(1).max(120),
    path: z.string().startsWith("/").max(1_000).refine(
      (value) => !value.startsWith("//") && !value.includes("\\") && !value.includes("\0"),
      "Journey paths must stay on the configured application origin",
    ),
    actions: z.array(actionSchema).max(20),
    assertions: z.array(assertionSchema).max(30),
    captureScreenshot: z.boolean().default(true),
  }).strict()).min(1).max(20),
  failOnConsoleError: z.boolean().default(true),
  failOnPageError: z.boolean().default(true),
  accessibility: z.object({
    requireImageAlt: z.boolean().default(true),
    requireControlNames: z.boolean().default(true),
    requireInputLabels: z.boolean().default(true),
  }).strict(),
  maxLayoutDifferenceRatio: z.number().min(0).max(0.5).default(0.08),
}).strict().superRefine((plan, context) => {
  if (plan.viewports.length * plan.journeys.length > 8) {
    context.addIssue({
      code: "custom",
      path: ["journeys"],
      message: "A release verification plan may produce at most eight browser captures",
    });
  }
});

export type ReleaseVerificationPlan = z.infer<typeof releaseVerificationPlanSchema>;

export interface UiLayoutNode {
  key: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface UiVerificationCapture {
  key: string;
  journeyId: string;
  viewport: { name: string; width: number; height: number };
  url: string;
  title: string;
  screenshotBase64: string | null;
  screenshotSha256: string | null;
  layout: UiLayoutNode[];
  consoleErrors: string[];
  pageErrors: string[];
  accessibilityViolations: string[];
  assertionFailures: string[];
}

export interface UiVerificationBaseline {
  schemaVersion: 1;
  planHash: string;
  headSha: string | null;
  capturedAt: string;
  captures: UiVerificationCapture[];
}

const defaultPlan: ReleaseVerificationPlan = {
  schemaVersion: 1,
  kind: "ui",
  viewports: [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ],
  journeys: [{
    id: "primary-page",
    name: "Primary application page",
    path: "/",
    actions: [],
    assertions: [{ type: "visible", selector: "body" }],
    captureScreenshot: true,
  }],
  failOnConsoleError: true,
  failOnPageError: true,
  accessibility: {
    requireImageAlt: true,
    requireControlNames: true,
    requireInputLabels: true,
  },
  maxLayoutDifferenceRatio: 0.08,
};

export function parseReleaseVerificationPlan(instructions: string): ReleaseVerificationPlan {
  const fenced = instructions.match(/```closespan-ui-verification\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) return structuredClone(defaultPlan);
  return releaseVerificationPlanSchema.parse(JSON.parse(fenced[1]));
}

export function hashReleaseVerificationPlan(plan: ReleaseVerificationPlan): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

function roundedDifference(left: number, right: number, scale: number): number {
  return Math.min(1, Math.abs(left - right) / Math.max(scale, 1));
}

export function compareUiLayouts(
  baseline: readonly UiLayoutNode[],
  actual: readonly UiLayoutNode[],
): { differenceRatio: number; missing: string[]; changed: string[] } {
  const actualByKey = new Map(actual.map((node) => [node.key, node]));
  const missing: string[] = [];
  const changed: string[] = [];
  let difference = 0;
  for (const expected of baseline) {
    const observed = actualByKey.get(expected.key);
    if (!observed) {
      missing.push(expected.key);
      difference += 1;
      continue;
    }
    const nodeDifference = (
      roundedDifference(expected.x, observed.x, expected.width)
      + roundedDifference(expected.y, observed.y, expected.height)
      + roundedDifference(expected.width, observed.width, expected.width)
      + roundedDifference(expected.height, observed.height, expected.height)
      + (expected.visible === observed.visible ? 0 : 1)
      + (expected.text === observed.text ? 0 : 0.5)
    ) / 6;
    difference += nodeDifference;
    if (nodeDifference > 0.1) changed.push(expected.key);
  }
  return {
    differenceRatio: baseline.length ? difference / baseline.length : actual.length ? 1 : 0,
    missing,
    changed,
  };
}

export function changedFilesNeedUiVerification(paths: readonly string[]): boolean {
  return paths.some((path) => {
    const normalized = path.replaceAll("\\", "/");
    return /\.(?:css|scss|sass|less|tsx|jsx|vue|svelte|html)$/.test(normalized)
      || /(?:^|\/)src\/(?:app|pages|components|ui|views)\//.test(normalized);
  });
}
