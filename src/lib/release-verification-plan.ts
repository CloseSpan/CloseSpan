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

const sameOriginPath = z.string().startsWith("/").max(1_000).refine(
  (value) => !value.startsWith("//") && !value.includes("\\") && !value.includes("\0"),
  "Verification paths must stay on the configured application origin",
);

const jsonPath = z.string().trim().min(1).max(300).regex(
  /^[A-Za-z_][A-Za-z0-9_-]*(?:\.(?:[A-Za-z_][A-Za-z0-9_-]*|\d+))*$/,
  "JSON assertion paths must use bounded dot notation",
);

const scalarValue = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);

const backendAssertionSchema = z.discriminatedUnion("operator", [
  z.object({ path: jsonPath, operator: z.literal("equals"), value: scalarValue }).strict(),
  z.object({ path: jsonPath, operator: z.literal("includes"), value: z.union([z.string().max(2_000), z.number().finite()]) }).strict(),
  z.object({ path: jsonPath, operator: z.literal("exists"), value: z.boolean().default(true) }).strict(),
  z.object({ path: jsonPath, operator: z.literal("type"), value: z.enum(["string", "number", "boolean", "object", "array", "null"]) }).strict(),
]);

const backendHeaderAssertionSchema = z.object({
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  operator: z.enum(["exists", "equals", "includes"]),
  value: z.string().max(500).optional(),
}).strict().superRefine((assertion, context) => {
  if (assertion.operator !== "exists" && assertion.value === undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "Header equality assertions require a value" });
  }
});

const backendCheckSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
  name: z.string().trim().min(1).max(120),
  method: z.enum(["GET", "HEAD"]),
  path: sameOriginPath,
  authProfile: z.enum(["none", "production-synthetic"]).default("none"),
  expectedStatus: z.number().int().min(100).max(599),
  maxDurationMs: z.number().int().min(500).max(15_000).default(5_000),
  headers: z.array(backendHeaderAssertionSchema).max(20).default([]),
  json: z.array(backendAssertionSchema).max(30).default([]),
}).strict().superRefine((check, context) => {
  if (check.method === "HEAD" && check.json.length) {
    context.addIssue({ code: "custom", path: ["json"], message: "HEAD checks cannot assert a JSON response body" });
  }
});

const frontendVerificationSchema = z.object({
  viewports: z.array(viewportSchema).min(1).max(6),
  journeys: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
    name: z.string().trim().min(1).max(120),
    path: sameOriginPath,
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

const legacyUiPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("ui"),
  viewports: z.array(viewportSchema).min(1).max(6),
  journeys: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,60}$/),
    name: z.string().trim().min(1).max(120),
    path: sameOriginPath,
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

const combinedPlanSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("combined"),
  requirements: z.object({
    backend: z.enum(["required", "not_required"]),
    frontend: z.enum(["required", "not_required"]),
  }).strict().refine(
    (requirements) => requirements.backend === "required" || requirements.frontend === "required",
    "At least one production verification section must be required",
  ),
  backend: z.object({ checks: z.array(backendCheckSchema).min(1).max(20) }).strict(),
  frontend: frontendVerificationSchema,
}).strict();

const defaultBackend = {
  checks: [{
    id: "application-health",
    name: "Application and database health",
    method: "GET" as const,
    path: "/api/health",
    authProfile: "none" as const,
    expectedStatus: 200,
    maxDurationMs: 5_000,
    headers: [{ name: "content-type", operator: "includes" as const, value: "application/json" }],
    json: [
      { path: "status", operator: "equals" as const, value: "ok" },
      { path: "database", operator: "equals" as const, value: "connected" },
    ],
  }],
};

function upgradeLegacyPlan(plan: z.infer<typeof legacyUiPlanSchema>) {
  const frontend = frontendVerificationSchema.parse({
    viewports: plan.viewports,
    journeys: plan.journeys,
    failOnConsoleError: plan.failOnConsoleError,
    failOnPageError: plan.failOnPageError,
    accessibility: plan.accessibility,
    maxLayoutDifferenceRatio: plan.maxLayoutDifferenceRatio,
  });
  return combinedPlanSchema.parse({
    schemaVersion: 2,
    kind: "combined",
    requirements: { backend: "required", frontend: "required" },
    backend: defaultBackend,
    frontend,
  });
}

export const releaseVerificationPlanSchema = z.union([
  combinedPlanSchema,
  legacyUiPlanSchema.transform(upgradeLegacyPlan),
]);

export type ReleaseVerificationPlan = z.infer<typeof releaseVerificationPlanSchema>;

export type ReleaseVerificationSurface = "backend" | "frontend" | "shared" | "neutral" | "unknown";

export interface ReleaseVerificationScopeAssessment {
  schemaVersion: 1;
  compatible: boolean;
  declared: { backend: boolean; frontend: boolean };
  observed: { backend: boolean; frontend: boolean; unknown: boolean };
  recommended: { backend: boolean; frontend: boolean };
  files: Array<{
    path: string;
    surface: ReleaseVerificationSurface;
  }>;
  mismatches: string[];
}

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
  schemaVersion: 2,
  kind: "combined",
  requirements: { backend: "required", frontend: "required" },
  backend: defaultBackend,
  frontend: {
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
  },
};

export function parseReleaseVerificationPlan(instructions: string): ReleaseVerificationPlan {
  const fenced = instructions.match(/```closespan-release-verification\s*([\s\S]*?)```/i)
    ?? instructions.match(/```closespan-ui-verification\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) return structuredClone(defaultPlan);
  return releaseVerificationPlanSchema.parse(JSON.parse(fenced[1]));
}

export function hashReleaseVerificationPlan(plan: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(releaseVerificationPlanSchema.parse(plan)), "utf8")
    .digest("hex");
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

function normalizeChangedPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function pathLooksLikeTest(path: string): boolean {
  return /(?:^|\/)(?:__tests__|test|tests|spec|specs|fixtures?|mocks?|e2e)(?:\/|$)/.test(path)
    || /\.(?:test|spec)\.[^.]+$/.test(path)
    || /(?:^|\/)playwright\.config\.[^.]+$/.test(path);
}

/**
 * Conservatively classifies the production surface implied by a changed path.
 * Unknown paths are intentional: a single-surface PDD must not silently approve
 * files whose runtime impact cannot be established from the immutable PR manifest.
 */
export function classifyReleaseVerificationFile(path: string): ReleaseVerificationSurface {
  const normalized = normalizeChangedPath(path);
  if (!normalized) return "unknown";
  if (pathLooksLikeTest(normalized)) return "neutral";
  if (
    /(?:^|\/)(?:docs?|examples?|storybook|stories)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:readme|changelog|license|contributing)(?:\.[^/]+)?$/.test(normalized)
    || /\.(?:md|mdx|txt|snap)$/.test(normalized)
  ) return "neutral";
  if (
    /(?:^|\/)(?:migrations?|prisma|drizzle|infra|infrastructure|terraform|deploy|deployment|auth|permissions?|shared|contracts?|schemas?|types?)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|dockerfile|docker-compose\.ya?ml|wrangler\.jsonc?|next\.config\.[^/]+|tsconfig\.json)$/.test(normalized)
    || /(?:^|\/)(?:auth|permissions?|contracts?|schemas?|types?)\.(?:ts|js|json)$/.test(normalized)
    || /\.(?:sql|graphql|gql|proto)$/.test(normalized)
  ) return "shared";
  if (
    /(?:^|\/)(?:src\/app\/api|app\/api|pages\/api|api|server|services?|workers?|jobs?|queues?|webhooks?|repositories?|database|db)(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:route|middleware|instrumentation)\.(?:ts|js|mts|mjs|cts|cjs)$/.test(normalized)
    || /\.(?:repository|service|server|worker|job|queue|webhook)\.(?:ts|js|mts|mjs|cts|cjs)$/.test(normalized)
    || /\.(?:go|rs|java|kt|rb|php|py)$/.test(normalized)
  ) return "backend";
  if (
    /(?:^|\/)(?:src\/app|app|src\/pages|pages|components?|ui|views?|client|public|assets?)(?:\/|$)/.test(normalized)
    || /\.(?:css|scss|sass|less|styl|html|jsx|tsx|vue|svelte)$/.test(normalized)
  ) return "frontend";
  return "unknown";
}

export function assessReleaseVerificationScope(
  plan: ReleaseVerificationPlan,
  changedFiles: readonly string[],
): ReleaseVerificationScopeAssessment {
  const normalizedPlan = releaseVerificationPlanSchema.parse(plan);
  const files = changedFiles.map((path) => ({
    path,
    surface: classifyReleaseVerificationFile(path),
  }));
  const declared = {
    backend: normalizedPlan.requirements.backend === "required",
    frontend: normalizedPlan.requirements.frontend === "required",
  };
  const observed = {
    backend: files.some((file) => file.surface === "backend" || file.surface === "shared"),
    frontend: files.some((file) => file.surface === "frontend" || file.surface === "shared"),
    unknown: files.some((file) => file.surface === "unknown"),
  };
  const recommended = {
    backend: declared.backend || observed.backend || observed.unknown,
    frontend: declared.frontend || observed.frontend || observed.unknown,
  };
  const mismatches: string[] = [];
  if (observed.backend && !declared.backend) {
    mismatches.push("The PR contains backend or shared changes, but backend production verification is not approved in the PDD contract.");
  }
  if (observed.frontend && !declared.frontend) {
    mismatches.push("The PR contains frontend or shared changes, but frontend production verification is not approved in the PDD contract.");
  }
  if (observed.unknown && !(declared.backend && declared.frontend)) {
    mismatches.push("Some changed files have an unknown runtime impact; both verification surfaces are required until the PDD classifies them.");
  }
  return {
    schemaVersion: 1,
    compatible: mismatches.length === 0,
    declared,
    observed,
    recommended,
    files,
    mismatches,
  };
}

export function combinedReleaseVerificationPassed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as {
    schemaVersion?: unknown;
    backend?: { required?: unknown; status?: unknown; checks?: Array<{ passed?: unknown }> };
    frontend?: { required?: unknown; status?: unknown; checks?: Array<{ passed?: unknown }> };
  };
  if (result.schemaVersion !== 2 || !result.backend || !result.frontend) return false;
  const backendSatisfied = result.backend.required === false
    ? result.backend.status === "Not required" && (result.backend.checks?.length ?? 0) === 0
    : result.backend.required === true
      && result.backend.status === "Passed"
      && Array.isArray(result.backend.checks)
      && result.backend.checks.length > 0
      && result.backend.checks.every((check) => check.passed === true);
  const frontendSatisfied = result.frontend.required === false
    ? result.frontend.status === "Not required" && (result.frontend.checks?.length ?? 0) === 0
    : result.frontend.required === true
      && result.frontend.status === "Passed"
      && Array.isArray(result.frontend.checks)
      && result.frontend.checks.length > 0
      && result.frontend.checks.every((check) => check.passed === true);
  return backendSatisfied && frontendSatisfied;
}
