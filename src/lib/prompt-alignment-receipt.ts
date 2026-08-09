import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PROMPT_ALIGNMENT_EVALUATOR_VERSION } from "./prompt-alignment-evaluation";

const receiptSchema = z.object({
  orgId: z.string().min(1).max(128),
  problemId: z.string().min(1).max(128),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  storyHash: z.string().regex(/^[a-f0-9]{64}$/),
  verdict: z.literal("Aligned"),
  evaluatorVersion: z.literal(PROMPT_ALIGNMENT_EVALUATOR_VERSION),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

function secret(): string {
  const value = (
    process.env.PROMPT_ALIGNMENT_SECRET ?? process.env.AUTH_SECRET
  )?.trim();
  if (!value || value.length < 32)
    throw new Error(
      "PROMPT_ALIGNMENT_SECRET or AUTH_SECRET with at least 32 characters is required",
    );
  return value;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function createPromptAlignmentReceipt(input: {
  orgId: string;
  problemId: string;
  promptHash: string;
  storyHash: string;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const payload = Buffer.from(
    JSON.stringify({
      orgId: input.orgId,
      problemId: input.problemId,
      promptHash: input.promptHash,
      storyHash: input.storyHash,
      verdict: "Aligned",
      evaluatorVersion: PROMPT_ALIGNMENT_EVALUATOR_VERSION,
      issuedAt: now,
      expiresAt: now + 30 * 60_000,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function assertPromptAlignmentReceipt(
  token: unknown,
  expected: {
    orgId: string;
    problemId: string;
    promptHash: string;
    storyHash: string;
    now?: number;
  },
): void {
  if (typeof token !== "string" || token.length > 4_096)
    throw new Error("A valid prompt-alignment receipt is required");
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra)
    throw new Error("A valid prompt-alignment receipt is required");
  const expectedSignature = signature(payload);
  let decodedSignature: Buffer;
  try {
    decodedSignature = Buffer.from(suppliedSignature, "base64url");
  } catch {
    throw new Error("A valid prompt-alignment receipt is required");
  }
  if (
    decodedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(decodedSignature, expectedSignature)
  )
    throw new Error("A valid prompt-alignment receipt is required");
  let parsed: z.infer<typeof receiptSchema>;
  try {
    parsed = receiptSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("A valid prompt-alignment receipt is required");
  }
  const now = expected.now ?? Date.now();
  if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000)
    throw new Error("The prompt-alignment receipt expired; test the prompt again");
  if (
    parsed.orgId !== expected.orgId ||
    parsed.problemId !== expected.problemId ||
    parsed.promptHash !== expected.promptHash ||
    parsed.storyHash !== expected.storyHash
  )
    throw new Error("The prompt-alignment receipt does not match this prompt and story");
}
