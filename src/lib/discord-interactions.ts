import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { HttpError } from "./request-security";

function publicKeyFromHex(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("DISCORD_PUBLIC_KEY must be a 32-byte hexadecimal Ed25519 key.");
  }
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(value, "hex")]),
    format: "der",
    type: "spki",
  });
}

export function verifyDiscordInteractionSignature(input: {
  body: string;
  signature: string | null;
  timestamp: string | null;
  publicKey?: string;
}): void {
  const key = input.publicKey ?? process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!key || !input.signature || !input.timestamp) {
    throw new HttpError(401, "Discord interaction signature is missing.");
  }
  if (!/^[0-9a-f]{128}$/i.test(input.signature)) {
    throw new HttpError(401, "Discord interaction signature is invalid.");
  }
  const signature = Buffer.from(input.signature, "hex");
  const valid = verify(
    null,
    Buffer.from(`${input.timestamp}${input.body}`, "utf8"),
    publicKeyFromHex(key),
    signature,
  );
  const expected = Buffer.from([1]);
  const observed = Buffer.from([valid ? 1 : 0]);
  if (!timingSafeEqual(expected, observed)) {
    throw new HttpError(401, "Discord interaction signature is invalid.");
  }
}

export function discordInteractionResponse(
  content: string,
  options: { ephemeral?: boolean; update?: boolean } = {},
): Response {
  return Response.json({
    type: options.update ? 7 : 4,
    data: {
      content,
      allowed_mentions: { parse: [] },
      ...(options.ephemeral ? { flags: 64 } : {}),
      ...(options.update ? { components: [] } : {}),
    },
  });
}
