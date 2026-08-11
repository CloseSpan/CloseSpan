import { z } from "zod";

const MAX_JOB_BYTES = 16_384;
const dispatchSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().uuid(),
  orgId: z.string().min(1).max(200),
}).strict();
type ReleaseDispatch = z.infer<typeof dispatchSchema>;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

async function validBearer(secret: string, authorization: string): Promise<boolean> {
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  ]);
  const left = new Uint8Array(actual);
  const right = new Uint8Array(expected);
  let mismatch = 0;
  for (let index = 0; index < right.length; index += 1) mismatch |= left[index]! ^ right[index]!;
  return mismatch === 0;
}

async function proxyExecution(env: Env, dispatch: ReleaseDispatch): Promise<void> {
  const body = JSON.stringify(dispatch);
  const response = await fetch(env.RELEASE_VERIFIER_EXECUTOR_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-closespan-signature": await hmac(env.RELEASE_VERIFIER_EXECUTOR_SHARED_SECRET, body),
    },
    body,
    signal: AbortSignal.timeout(4 * 60_000),
  });
  if (!response.ok) throw new Error(`Release verifier executor returned HTTP ${response.status}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!await validBearer(env.STATUS_PROBE_SECRET, request.headers.get("authorization") ?? ""))
        return new Response("Not found", { status: 404 });
      return Response.json({ status: "ok", timestamp: new Date().toISOString() }, {
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
    if (request.method !== "POST" || url.pathname !== "/jobs")
      return new Response("Not found", { status: 404 });
    if (!await validBearer(env.RELEASE_VERIFIER_SHARED_SECRET, request.headers.get("authorization") ?? ""))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_JOB_BYTES)
      return Response.json({ error: "Dispatch is too large" }, { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JOB_BYTES)
      return Response.json({ error: "Dispatch is too large" }, { status: 413 });
    let dispatch: ReleaseDispatch;
    try {
      dispatch = dispatchSchema.parse(JSON.parse(body));
    } catch {
      return Response.json({ error: "Invalid release verification dispatch" }, { status: 400 });
    }
    await env.RELEASE_VERIFICATIONS.send(dispatch);
    return Response.json({ accepted: true, jobId: dispatch.jobId }, { status: 202 });
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const dispatch = dispatchSchema.parse(message.body);
        await proxyExecution(env, dispatch);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "release_verification_failed",
          error: error instanceof Error ? error.message : "unknown",
          attempts: message.attempts,
        }));
        message.retry({ delaySeconds: message.attempts >= 2 ? 300 : 60 });
      }
    }
  },
} satisfies ExportedHandler<Env>;
