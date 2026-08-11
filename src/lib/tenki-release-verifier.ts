import { Buffer } from "node:buffer";
import { TenkiSandbox, type Session } from "@tenkicloud/sandbox";
import { z } from "zod";
import {
  compareUiLayouts,
  hashReleaseVerificationPlan,
  releaseVerificationPlanSchema,
  type UiVerificationBaseline,
  type UiVerificationCapture,
} from "./release-verification-plan";

const MAX_RESULT_BYTES = 4_000_000;
const RUNNER_PATH = "/home/tenki/release-verifier.mjs";
const JOB_PATH = "/home/tenki/release-verification-job.json";
const RESULT_PATH = "/home/tenki/release-verification-result.json";

export const releaseVerifierJobSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().uuid(),
  orgId: z.string().min(1).max(200),
  problemId: z.string().min(1).max(200),
  agentRunId: z.string().uuid(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  environment: z.string().min(1).max(200),
  deploymentSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  approvedHeadSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  baseUrl: z.string().url().max(2_000),
  verificationInstructions: z.string().min(3).max(5_000),
  plan: releaseVerificationPlanSchema,
  baseline: z.unknown().nullable(),
  callbackUrl: z.string().url().max(2_000),
  expiresAt: z.string().datetime(),
}).strict();

export type ReleaseVerifierJob = z.infer<typeof releaseVerifierJobSchema>;

export interface BackendVerificationCheckResult {
  id: string;
  name: string;
  method: "GET" | "HEAD";
  path: string;
  statusCode: number | null;
  durationMs: number;
  passed: boolean;
  failures: string[];
}

export interface ReleaseVerifierResult {
  status: "Passed" | "Failed";
  evidence: string;
  result: {
    schemaVersion: 2;
    deploymentSha: string;
    baseUrl: string;
    completedAt: string;
    backend: {
      required: boolean;
      status: "Passed" | "Failed" | "Not required";
      checks: BackendVerificationCheckResult[];
    };
    frontend: {
      required: boolean;
      status: "Passed" | "Failed" | "Not required";
      checks: Array<{ key: string; passed: boolean; detail: string }>;
      captures: UiVerificationCapture[];
    };
    captures: UiVerificationCapture[];
    checks: Array<{ key: string; passed: boolean; detail: string }>;
  };
}

export const TENKI_RELEASE_VERIFIER_RUNNER_SOURCE = String.raw`
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const [jobPath, resultPath] = process.argv.slice(2);
const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
const origin = new URL(job.baseUrl).origin;
const storageState = process.env.CLOSESPAN_RELEASE_STORAGE_STATE
  ? JSON.parse(process.env.CLOSESPAN_RELEASE_STORAGE_STATE)
  : undefined;
const syntheticBearer = process.env.CLOSESPAN_RELEASE_SYNTHETIC_BEARER || "";
const backendChecks = [];
const captures = [];
let browser;
try {
  if (job.plan.requirements.backend === "required") {
    for (const check of job.plan.backend.checks) {
      const startedAt = Date.now();
      const failures = [];
      let statusCode = null;
      try {
        const target = new URL(check.path, origin);
        if (target.origin !== origin) throw new Error("Backend target escaped the configured origin");
        if (check.authProfile === "production-synthetic" && !syntheticBearer)
          throw new Error("Synthetic production authentication is not configured");
        const headers = { accept: "application/json" };
        if (check.authProfile === "production-synthetic") headers.authorization = "Bearer " + syntheticBearer;
        const response = await fetch(target, {
          method: check.method,
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(check.maxDurationMs),
        });
        statusCode = response.status;
        if (response.status !== check.expectedStatus)
          failures.push("Expected HTTP " + check.expectedStatus + " but received " + response.status);
        const elapsed = Date.now() - startedAt;
        if (elapsed > check.maxDurationMs) failures.push("Response exceeded the approved duration limit");
        for (const assertion of check.headers) {
          const actual = response.headers.get(assertion.name);
          if (assertion.operator === "exists" && actual === null) failures.push("Required response header " + assertion.name + " is missing");
          if (assertion.operator === "equals" && actual !== assertion.value) failures.push("Response header " + assertion.name + " did not equal the approved value");
          if (assertion.operator === "includes" && !(actual || "").includes(assertion.value || "")) failures.push("Response header " + assertion.name + " did not include the approved value");
        }
        if (check.method !== "HEAD" && check.json.length) {
          const declaredLength = Number(response.headers.get("content-length") || 0);
          if (Number.isFinite(declaredLength) && declaredLength > 262144)
            throw new Error("Backend response exceeds 256 KB");
          const reader = response.body?.getReader();
          const chunks = [];
          let received = 0;
          if (reader) {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              received += next.value.byteLength;
              if (received > 262144) {
                await reader.cancel();
                throw new Error("Backend response exceeds 256 KB");
              }
              chunks.push(next.value);
            }
          }
          const body = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
          let json;
          try { json = JSON.parse(new TextDecoder().decode(body)); }
          catch { throw new Error("Backend response is not valid JSON"); }
          const readPath = (value, path) => path.split(".").reduce((current, part) => {
            if (current === null || current === undefined || typeof current !== "object") return undefined;
            return current[part];
          }, value);
          for (const assertion of check.json) {
            const actual = readPath(json, assertion.path);
            if (assertion.operator === "equals" && !Object.is(actual, assertion.value)) failures.push("JSON field " + assertion.path + " did not equal the approved value");
            if (assertion.operator === "includes" && !(typeof actual === "string" && actual.includes(String(assertion.value))) && !(Array.isArray(actual) && actual.includes(assertion.value))) failures.push("JSON field " + assertion.path + " did not include the approved value");
            if (assertion.operator === "exists" && (actual !== undefined) !== assertion.value) failures.push("JSON field " + assertion.path + " existence differed from the approved contract");
            if (assertion.operator === "type") {
              const actualType = actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual;
              if (actualType !== assertion.value) failures.push("JSON field " + assertion.path + " did not have the approved type");
            }
          }
        } else if (response.body) {
          await response.body.cancel();
        }
      } catch (error) {
        failures.push((error?.name === "TimeoutError" ? "Backend request timed out" : error?.message || "Backend request failed").slice(0, 500));
      }
      backendChecks.push({
        id: check.id,
        name: check.name,
        method: check.method,
        path: check.path,
        statusCode,
        durationMs: Date.now() - startedAt,
        passed: failures.length === 0,
        failures,
      });
    }
  }
  if (job.plan.requirements.frontend === "required") {
    browser = await chromium.launch({ headless: true });
  }
  for (const journey of job.plan.requirements.frontend === "required" ? job.plan.frontend.journeys : []) {
    for (const viewport of job.plan.frontend.viewports) {
      const context = await browser.newContext({
        viewport,
        serviceWorkers: "block",
        reducedMotion: "reduce",
        colorScheme: "dark",
        storageState,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error" && consoleErrors.length < 50)
          consoleErrors.push(message.text().slice(0, 1000));
      });
      page.on("pageerror", (error) => {
        if (pageErrors.length < 50) pageErrors.push(error.message.slice(0, 1000));
      });
      await page.route("**/*", async (route) => {
        try {
          const target = new URL(route.request().url());
          if (target.origin === origin || target.protocol === "data:") await route.continue();
          else await route.abort("blockedbyclient");
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      await page.goto(new URL(journey.path, origin).toString(), {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      for (const action of journey.actions) {
        if (action.type === "click") await page.locator(action.selector).click({ timeout: 10_000 });
        else if (action.type === "fill") await page.locator(action.selector).fill(action.value, { timeout: 10_000 });
        else if (action.type === "press") await page.locator(action.selector).press(action.key, { timeout: 10_000 });
      }
      const assertionFailures = [];
      for (const assertion of journey.assertions) {
        try {
          if (assertion.type === "visible" && !await page.locator(assertion.selector).first().isVisible()) throw new Error("is not visible");
          if (assertion.type === "hidden" && await page.locator(assertion.selector).first().isVisible()) throw new Error("is visible");
          if (assertion.type === "text" && !(await page.locator(assertion.selector).first().innerText()).includes(assertion.value)) throw new Error("text differs");
          if (assertion.type === "url" && !page.url().includes(assertion.value)) throw new Error("URL differs");
          if (assertion.type === "count" && await page.locator(assertion.selector).count() !== assertion.value) throw new Error("count differs");
        } catch (error) {
          assertionFailures.push((assertion.type + ": " + (assertion.selector || assertion.value) + " " + (error.message || "failed")).slice(0, 1000));
        }
      }
      const accessibilityViolations = await page.evaluate((accessibility) => {
        const failures = [];
        if (accessibility.requireImageAlt) for (const image of document.querySelectorAll("img")) if (!image.hasAttribute("alt")) failures.push("Image is missing alt text");
        if (accessibility.requireControlNames) for (const control of document.querySelectorAll("button,a[href],[role=button]")) {
          const name = control.getAttribute("aria-label") || control.textContent || control.getAttribute("title") || "";
          if (!name.trim()) failures.push("Interactive control is missing an accessible name");
        }
        if (accessibility.requireInputLabels) for (const input of document.querySelectorAll("input,textarea,select")) {
          const id = input.getAttribute("id");
          const labelled = input.getAttribute("aria-label") || input.getAttribute("aria-labelledby") || (id && document.querySelector('label[for="' + CSS.escape(id) + '"]'));
          if (!labelled) failures.push("Form field is missing a label");
        }
        return failures.slice(0, 100);
      }, job.plan.frontend.accessibility);
      const layout = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("body,[data-testid],[id],main,nav,section,article,dialog,h1,h2,h3,button,a[href],input,textarea,select"));
        const counts = new Map();
        return candidates.slice(0, 500).map((element) => {
          const rect = element.getBoundingClientRect();
          const role = element.getAttribute("role") || element.tagName.toLowerCase();
          const name = (element.getAttribute("data-testid") || element.id || element.getAttribute("aria-label") || (element.textContent || "").trim().slice(0, 80)).replace(/\s+/g, " ");
          const base = role + ":" + name;
          const ordinal = (counts.get(base) || 0) + 1;
          counts.set(base, ordinal);
          const style = getComputedStyle(element);
          return { key: base + ":" + ordinal, text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 };
        });
      });
      const screenshot = journey.captureScreenshot ? await page.screenshot({ type: "png", fullPage: false }) : null;
      if (screenshot && screenshot.byteLength > 337_500) throw new Error("Production screenshot exceeds 337.5 KB");
      captures.push({
        key: journey.id + ":" + viewport.name,
        journeyId: journey.id,
        viewport,
        url: page.url(),
        title: (await page.title()).slice(0, 1000),
        screenshotBase64: screenshot ? screenshot.toString("base64") : null,
        screenshotSha256: screenshot ? crypto.createHash("sha256").update(screenshot).digest("hex") : null,
        layout,
        consoleErrors,
        pageErrors,
        accessibilityViolations,
        assertionFailures,
      });
      await context.close();
    }
  }
  await fs.writeFile(resultPath, JSON.stringify({ backendChecks, captures }), "utf8");
} finally {
  await browser?.close().catch(() => undefined);
}
`;

function allowedBaseUrl(job: ReleaseVerifierJob): URL {
  const url = new URL(job.baseUrl);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("Production release verification requires HTTPS");
  if (url.username || url.password) throw new Error("Release verification URLs may not contain credentials");
  const allowedHosts = (process.env.RELEASE_VERIFIER_ALLOWED_HOSTS ?? "")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase()))
    throw new Error("Release verification target is not allowlisted");
  return url;
}

function verifiedBaseline(value: unknown, job: ReleaseVerifierJob): UiVerificationBaseline | null {
  if (!value || typeof value !== "object") return null;
  const baseline = value as UiVerificationBaseline;
  if (
    baseline.schemaVersion !== 1
    || baseline.headSha !== job.approvedHeadSha
    || baseline.planHash !== hashReleaseVerificationPlan(job.plan)
  )
    throw new Error("UI baseline is not bound to the deployed commit");
  return baseline;
}

export async function executeTenkiReleaseVerification(
  input: unknown,
  dependencies: {
    createClient?: (key: string) => TenkiSandbox;
    storageState?: string;
    syntheticBearerToken?: string;
  } = {},
): Promise<ReleaseVerifierResult> {
  const job = releaseVerifierJobSchema.parse(input);
  if (Date.parse(job.expiresAt) <= Date.now()) throw new Error("Release verification job expired");
  const baseUrl = allowedBaseUrl(job);
  const baseline = verifiedBaseline(job.baseline, job);
  const apiKey = process.env.TENKI_API_KEY?.trim();
  if (!apiKey) throw new Error("TENKI_API_KEY is required for release verification");
  const image = process.env.TENKI_RELEASE_VERIFIER_IMAGE?.trim();
  const snapshotId = process.env.TENKI_RELEASE_VERIFIER_SNAPSHOT_ID?.trim();
  if (!image && !snapshotId) throw new Error("A Playwright-enabled Tenki release verifier image or snapshot is required");
  if (image && snapshotId) throw new Error("Configure one Tenki release verifier boot source");

  const client = dependencies.createClient?.(apiKey) ?? new TenkiSandbox({ authToken: apiKey, timeoutMs: 60_000 });
  let session: Session | undefined;
  try {
    session = await client.createAndWait({
      name: `release-verifier-${job.jobId.slice(0, 8)}`,
      allowInbound: false,
      allowOutbound: true,
      maxDurationMs: 4 * 60_000,
      idleTimeoutMinutes: 2,
      cpuCores: 2,
      memoryMb: 4_096,
      ...(image ? { image } : { snapshotId }),
      metadata: { purpose: "release-verification", jobId: job.jobId, orgId: job.orgId },
    });
    if (session.inboundEnabled || !session.outboundEnabled)
      throw new Error("Tenki release verifier networking does not match the sealed profile");
    await session.writeFile(RUNNER_PATH, TENKI_RELEASE_VERIFIER_RUNNER_SOURCE);
    await session.writeFile(JOB_PATH, JSON.stringify({ ...job, baseUrl: baseUrl.toString() }));
    const execution = await session.exec("node", {
      args: [RUNNER_PATH, JOB_PATH, RESULT_PATH],
      timeoutMs: 3 * 60_000,
      env: dependencies.storageState
        ? {
            CLOSESPAN_RELEASE_STORAGE_STATE: dependencies.storageState,
            ...(dependencies.syntheticBearerToken ? { CLOSESPAN_RELEASE_SYNTHETIC_BEARER: dependencies.syntheticBearerToken } : {}),
          }
        : dependencies.syntheticBearerToken
          ? { CLOSESPAN_RELEASE_SYNTHETIC_BEARER: dependencies.syntheticBearerToken }
          : {},
    });
    if (execution.exitCode !== 0)
      throw new Error(`Production verification failed: ${Buffer.from(execution.stderr).toString("utf8").slice(-2_000)}`);
    const bytes = await session.readFile(RESULT_PATH);
    if (bytes.byteLength > MAX_RESULT_BYTES) throw new Error("Release verification evidence exceeds 4 MB");
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
      backendChecks?: BackendVerificationCheckResult[];
      captures?: UiVerificationCapture[];
    };
    const backendChecks = parsed.backendChecks ?? [];
    const captures = parsed.captures ?? [];
    const frontendChecks: ReleaseVerifierResult["result"]["checks"] = [];
    const baselineByKey = new Map(baseline?.captures.map((capture) => [capture.key, capture]) ?? []);
    for (const capture of captures) {
      frontendChecks.push({ key: `${capture.key}:assertions`, passed: capture.assertionFailures.length === 0, detail: capture.assertionFailures.join("; ") || "All declarative assertions passed" });
      frontendChecks.push({ key: `${capture.key}:console`, passed: !job.plan.frontend.failOnConsoleError || capture.consoleErrors.length === 0, detail: capture.consoleErrors.join("; ") || "No browser console errors" });
      frontendChecks.push({ key: `${capture.key}:page-errors`, passed: !job.plan.frontend.failOnPageError || capture.pageErrors.length === 0, detail: capture.pageErrors.join("; ") || "No uncaught page errors" });
      frontendChecks.push({ key: `${capture.key}:accessibility`, passed: capture.accessibilityViolations.length === 0, detail: capture.accessibilityViolations.join("; ") || "Required accessibility checks passed" });
      const expected = baselineByKey.get(capture.key);
      if (expected) {
        const comparison = compareUiLayouts(expected.layout, capture.layout);
        frontendChecks.push({
          key: `${capture.key}:approved-layout`,
          passed: comparison.differenceRatio <= job.plan.frontend.maxLayoutDifferenceRatio,
          detail: `Layout difference ${(comparison.differenceRatio * 100).toFixed(2)}%; ${comparison.missing.length} missing and ${comparison.changed.length} materially changed elements`,
        });
      }
    }
    if (job.plan.requirements.frontend === "required" && captures.length !== job.plan.frontend.journeys.length * job.plan.frontend.viewports.length)
      frontendChecks.push({ key: "capture-completeness", passed: false, detail: "Not every approved journey and viewport produced evidence" });
    const backendRequired = job.plan.requirements.backend === "required";
    const frontendRequired = job.plan.requirements.frontend === "required";
    const backendStatus = !backendRequired
      ? "Not required" as const
      : backendChecks.length === job.plan.backend.checks.length && backendChecks.every((check) => check.passed)
        ? "Passed" as const
        : "Failed" as const;
    const frontendStatus = !frontendRequired
      ? "Not required" as const
      : frontendChecks.length > 0 && frontendChecks.every((check) => check.passed)
        ? "Passed" as const
        : "Failed" as const;
    const backendSummaryChecks = backendChecks.map((check) => ({
      key: `backend:${check.id}`,
      passed: check.passed,
      detail: check.failures.join("; ") || `${check.method} ${check.path} returned HTTP ${check.statusCode} in ${check.durationMs} ms`,
    }));
    const checks = [...backendSummaryChecks, ...frontendChecks];
    const passed = (!backendRequired || backendStatus === "Passed")
      && (!frontendRequired || frontendStatus === "Passed");
    return {
      status: passed ? "Passed" : "Failed",
      evidence: passed
        ? `${backendChecks.length} backend checks and ${captures.length} frontend captures satisfied the approved ${job.deploymentSha.slice(0, 8)} verification contract.`
        : checks.filter((check) => !check.passed).map((check) => `${check.key}: ${check.detail}`).join("\n").slice(0, 10_000),
      result: {
        schemaVersion: 2,
        deploymentSha: job.deploymentSha,
        baseUrl: baseUrl.toString(),
        completedAt: new Date().toISOString(),
        backend: { required: backendRequired, status: backendStatus, checks: backendChecks },
        frontend: { required: frontendRequired, status: frontendStatus, checks: frontendChecks, captures },
        captures,
        checks,
      },
    };
  } finally {
    await session?.close().catch(() => undefined);
    client.close();
  }
}
