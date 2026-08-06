import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const apiKey = process.env.TENKI_API_KEY?.trim();
if (!apiKey) throw new Error("TENKI_API_KEY is required");
const stableSlug = process.env.PDD_RUNNER_STABLE_SLUG?.trim() || "closespan-pdd-production";

async function recordedSessionId() {
  try {
    const state = JSON.parse(await fs.readFile(path.join(process.cwd(), ".tenki/pdd-runner.json"), "utf8"));
    return typeof state.sessionId === "string" ? state.sessionId : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

const client = new TenkiSandbox({ authToken: apiKey, timeoutMs: 60_000 });
try {
  const routes = (await client.previewUrls.list()).filter((route) => route.slug === stableSlug);
  if (routes.length > 1)
    throw new Error(`Multiple stable PreviewUrls use slug ${stableSlug}; refusing an ambiguous stop`);
  const route = routes[0] ?? null;
  const sessionId = route?.sessionId ?? await recordedSessionId();
  if (!sessionId)
    throw new Error("No stable or locally recorded PDD runner was found; refusing a broad tag-based stop");
  const session = await client.get(sessionId);
  if (
    !session.tags.includes("pdd-runner")
    || session.metadata.purpose !== "pdd-test-generation"
  ) throw new Error(`Session ${sessionId} is not an attested PDD runner`);
  await session.closeIfOpen();
  if (route?.sessionId === sessionId) await client.previewUrls.unbind(route.id);
  console.log(JSON.stringify({ stopped: [sessionId], count: 1, stableSlug }));
} finally {
  client.close();
}
