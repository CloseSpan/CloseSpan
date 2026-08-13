import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  orgId: z.string().min(1).max(128),
  problemId: z.string().min(1).max(128),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  storyHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

function secret(): string {
  const value = (process.env.PROMPT_ALIGNMENT_SECRET ?? process.env.AUTH_SECRET)?.trim();
  if (!value || value.length < 32) throw new Error("A prompt revision signing secret is required");
  return value;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function createPddPromptRevisionReceipt(input: {
  orgId: string; problemId: string; promptHash: string; revisionHash: string; storyHash: string;
}): string {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({
    ...input, issuedAt, expiresAt: issuedAt + 30 * 60_000,
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function assertPddPromptRevisionReceipt(token: unknown, expected: {
  orgId: string; problemId: string; promptHash: string; revisionHash: string; storyHash: string;
}): void {
  if (typeof token !== "string" || token.length > 4_096) throw new Error("A valid Prompt Testing revision receipt is required");
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) throw new Error("A valid Prompt Testing revision receipt is required");
  const expectedSignature = signature(payload);
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) {
    throw new Error("A valid Prompt Testing revision receipt is required");
  }
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); }
  catch { throw new Error("A valid Prompt Testing revision receipt is required"); }
  const now = Date.now();
  if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000) throw new Error("The Prompt Testing revision expired; test the prompt again");
  for (const key of ["orgId", "problemId", "promptHash", "revisionHash", "storyHash"] as const) {
    if (parsed[key] !== expected[key]) throw new Error("The Prompt Testing revision does not match this prompt and story");
  }
}
