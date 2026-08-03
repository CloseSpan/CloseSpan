import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const environmentPath = path.join(process.cwd(), ".env");
const legacyEnvironmentPath = path.join(process.cwd(), ".env.local");

function upsert(source, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function remove(source, name) {
  return source
    .replace(new RegExp(`^${name}=.*(?:\n|$)`, "gm"), "")
    .replace(/\n{3,}/g, "\n\n");
}

async function readIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

let source = await readIfPresent(environmentPath);
let legacySource = await readIfPresent(legacyEnvironmentPath);

const existingSecret = /^PDD_RUNNER_SHARED_SECRET=(.+)$/m.exec(source)?.[1]?.trim();
const legacySecret = /^PDD_RUNNER_SHARED_SECRET=(.+)$/m.exec(legacySource)?.[1]?.trim();
const legacyCallbackOrigin = /^CLOSESPAN_CALLBACK_ORIGIN=(.+)$/m.exec(legacySource)?.[1]?.trim();
const sharedSecret = existingSecret || legacySecret || randomBytes(32).toString("hex");
const callbackOrigin = /^CLOSESPAN_CALLBACK_ORIGIN=(.+)$/m.exec(source)?.[1]?.trim()
  || process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim()
  || legacyCallbackOrigin
  || "https://www.closespan.com";

source = upsert(source, "PDD_RUNNER_SHARED_SECRET", sharedSecret);
source = upsert(source, "CLOSESPAN_CALLBACK_ORIGIN", callbackOrigin.replace(/\/$/, ""));
const runnerUrl = process.env.PDD_RUNNER_URL?.trim().replace(/\/$/, "");
if (runnerUrl) source = upsert(source, "PDD_RUNNER_URL", runnerUrl);
await fs.writeFile(environmentPath, source, { mode: 0o600 });
await fs.chmod(environmentPath, 0o600);
if (legacySource) {
  legacySource = remove(legacySource, "PDD_RUNNER_SHARED_SECRET");
  legacySource = remove(legacySource, "CLOSESPAN_CALLBACK_ORIGIN");
  await fs.writeFile(legacyEnvironmentPath, legacySource, { mode: 0o600 });
  await fs.chmod(legacyEnvironmentPath, 0o600);
}

console.log(JSON.stringify({
  configured: true,
  generatedSharedSecret: !existingSecret && !legacySecret,
  migratedFromEnvLocal: Boolean(legacySecret || legacyCallbackOrigin),
  callbackOrigin: callbackOrigin.replace(/\/$/, ""),
  runnerUrlConfigured: Boolean(runnerUrl || /^PDD_RUNNER_URL=.+$/m.test(source)),
  secretPrinted: false,
}));
