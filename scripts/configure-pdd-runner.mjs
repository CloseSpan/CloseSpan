import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const environmentPath = path.join(process.cwd(), ".env");

function upsert(source, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
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

const existingSecret = /^PDD_RUNNER_SHARED_SECRET=(.+)$/m.exec(source)?.[1]?.trim();
const sharedSecret = existingSecret || randomBytes(32).toString("hex");
const callbackOrigin = /^CLOSESPAN_CALLBACK_ORIGIN=(.+)$/m.exec(source)?.[1]?.trim()
  || process.env.CLOSESPAN_INTERNAL_BASE_URL?.trim()
  || "https://www.closespan.com";

source = upsert(source, "PDD_RUNNER_SHARED_SECRET", sharedSecret);
source = upsert(source, "CLOSESPAN_CALLBACK_ORIGIN", callbackOrigin.replace(/\/$/, ""));
const runnerUrl = process.env.PDD_RUNNER_URL?.trim().replace(/\/$/, "");
if (runnerUrl) source = upsert(source, "PDD_RUNNER_URL", runnerUrl);
await fs.writeFile(environmentPath, source, { mode: 0o600 });
await fs.chmod(environmentPath, 0o600);

console.log(JSON.stringify({
  configured: true,
  generatedSharedSecret: !existingSecret,
  environmentFile: ".env",
  callbackOrigin: callbackOrigin.replace(/\/$/, ""),
  runnerUrlConfigured: Boolean(runnerUrl || /^PDD_RUNNER_URL=.+$/m.test(source)),
  secretPrinted: false,
}));
