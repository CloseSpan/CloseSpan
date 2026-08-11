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

export interface ReleaseVerifierResult {
  status: "Passed" | "Failed";
  evidence: string;
  result: {
    schemaVersion: 1;
    deploymentSha: string;
    baseUrl: string;
    completedAt: string;
    captures: UiVerificationCapture[];
    checks: Array<{ key: string; passed: boolean; detail: string }>;
  };
}

const RUNNER_SOURCE = String.raw`
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { chromium } from "playwright";

const [jobPath, resultPath] = process.argv.slice(2);
const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
const origin = new URL(job.baseUrl).origin;
const storageState = process.env.CLOSESPAN_RELEASE_STORAGE_STATE
  ? JSON.parse(process.env.CLOSESPAN_RELEASE_STORAGE_STATE)
  : undefined;
const captures = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const journey of job.plan.journeys) {
    for (const viewport of job.plan.viewports) {
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
      }, job.plan.accessibility);
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
  await fs.writeFile(resultPath, JSON.stringify({ captures }), "utf8");
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
    await session.writeFile(RUNNER_PATH, RUNNER_SOURCE);
    await session.writeFile(JOB_PATH, JSON.stringify({ ...job, baseUrl: baseUrl.toString() }));
    const execution = await session.exec("node", {
      args: [RUNNER_PATH, JOB_PATH, RESULT_PATH],
      timeoutMs: 3 * 60_000,
      env: dependencies.storageState
        ? { CLOSESPAN_RELEASE_STORAGE_STATE: dependencies.storageState }
        : {},
    });
    if (execution.exitCode !== 0)
      throw new Error(`Production browser verification failed: ${Buffer.from(execution.stderr).toString("utf8").slice(-2_000)}`);
    const bytes = await session.readFile(RESULT_PATH);
    if (bytes.byteLength > MAX_RESULT_BYTES) throw new Error("Release verification evidence exceeds 4 MB");
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as { captures?: UiVerificationCapture[] };
    const captures = parsed.captures ?? [];
    const checks: ReleaseVerifierResult["result"]["checks"] = [];
    const baselineByKey = new Map(baseline?.captures.map((capture) => [capture.key, capture]) ?? []);
    for (const capture of captures) {
      checks.push({ key: `${capture.key}:assertions`, passed: capture.assertionFailures.length === 0, detail: capture.assertionFailures.join("; ") || "All declarative assertions passed" });
      checks.push({ key: `${capture.key}:console`, passed: !job.plan.failOnConsoleError || capture.consoleErrors.length === 0, detail: capture.consoleErrors.join("; ") || "No browser console errors" });
      checks.push({ key: `${capture.key}:page-errors`, passed: !job.plan.failOnPageError || capture.pageErrors.length === 0, detail: capture.pageErrors.join("; ") || "No uncaught page errors" });
      checks.push({ key: `${capture.key}:accessibility`, passed: capture.accessibilityViolations.length === 0, detail: capture.accessibilityViolations.join("; ") || "Required accessibility checks passed" });
      const expected = baselineByKey.get(capture.key);
      if (expected) {
        const comparison = compareUiLayouts(expected.layout, capture.layout);
        checks.push({
          key: `${capture.key}:approved-layout`,
          passed: comparison.differenceRatio <= job.plan.maxLayoutDifferenceRatio,
          detail: `Layout difference ${(comparison.differenceRatio * 100).toFixed(2)}%; ${comparison.missing.length} missing and ${comparison.changed.length} materially changed elements`,
        });
      }
    }
    if (captures.length !== job.plan.journeys.length * job.plan.viewports.length)
      checks.push({ key: "capture-completeness", passed: false, detail: "Not every approved journey and viewport produced evidence" });
    const passed = checks.length > 0 && checks.every((check) => check.passed);
    return {
      status: passed ? "Passed" : "Failed",
      evidence: passed
        ? `${captures.length} production UI captures matched the approved ${job.deploymentSha.slice(0, 8)} verification contract.`
        : checks.filter((check) => !check.passed).map((check) => `${check.key}: ${check.detail}`).join("\n").slice(0, 10_000),
      result: {
        schemaVersion: 1,
        deploymentSha: job.deploymentSha,
        baseUrl: baseUrl.toString(),
        completedAt: new Date().toISOString(),
        captures,
        checks,
      },
    };
  } finally {
    await session?.close().catch(() => undefined);
    client.close();
  }
}
