import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const receiptSchema = z.object({
  orgId: z.string().min(1).max(128),
  problemId: z.string().min(1).max(128),
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

function signingSecret(): string {
  const value = (
    process.env.PROMPT_ALIGNMENT_SECRET ?? process.env.AUTH_SECRET
  )?.trim();
  if (!value || value.length < 32) {
    throw new Error("A prompt conversation signing secret is required");
  }
  return value;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", signingSecret()).update(payload).digest();
}

export function createPromptConversationRevisionReceipt(input: {
  orgId: string;
  problemId: string;
  promptHash: string;
  revisionHash: string;
  messageHash: string;
  now?: number;
}): string {
  const issuedAt = input.now ?? Date.now();
  const payload = Buffer.from(JSON.stringify({
    orgId: input.orgId,
    problemId: input.problemId,
    promptHash: input.promptHash,
    revisionHash: input.revisionHash,
    messageHash: input.messageHash,
    issuedAt,
    expiresAt: issuedAt + 30 * 60_000,
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function assertPromptConversationRevisionReceipt(
  token: unknown,
  expected: {
    orgId: string;
    problemId: string;
    promptHash: string;
    revisionHash: string;
    messageHash: string;
    now?: number;
  },
): void {
  if (typeof token !== "string" || token.length > 4_096) {
    throw new Error("A valid prompt conversation revision receipt is required");
  }
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) {
    throw new Error("A valid prompt conversation revision receipt is required");
  }
  const expectedSignature = signature(payload);
  const actualSignature = Buffer.from(suppliedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("A valid prompt conversation revision receipt is required");
  }
  let parsed: z.infer<typeof receiptSchema>;
  try {
    parsed = receiptSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("A valid prompt conversation revision receipt is required");
  }
  const now = expected.now ?? Date.now();
  if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000) {
    throw new Error("The prompt conversation improvement expired; ask CloseSpan again");
  }
  for (const key of [
    "orgId",
    "problemId",
    "promptHash",
    "revisionHash",
    "messageHash",
  ] as const) {
    if (parsed[key] !== expected[key]) {
      throw new Error("The prompt conversation improvement no longer matches this prompt");
    }
  }
}
