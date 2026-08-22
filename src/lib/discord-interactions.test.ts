import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  discordInteractionResponse,
  verifyDiscordInteractionSignature,
} from "./discord-interactions";

function keyMaterial() {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey: pair.privateKey,
    publicKey: der.subarray(der.length - 32).toString("hex"),
  };
}

describe("Discord interactions", () => {
  it("accepts a Discord Ed25519 request signature", () => {
    const keys = keyMaterial();
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1787421600";
    const signature = sign(
      null,
      Buffer.from(`${timestamp}${body}`, "utf8"),
      keys.privateKey,
    ).toString("hex");

    expect(() =>
      verifyDiscordInteractionSignature({
        body,
        timestamp,
        signature,
        publicKey: keys.publicKey,
      }),
    ).not.toThrow();
  });

  it("rejects changed payloads and malformed signatures", () => {
    const keys = keyMaterial();
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1787421600";
    const signature = sign(
      null,
      Buffer.from(`${timestamp}${body}`, "utf8"),
      keys.privateKey,
    ).toString("hex");

    expect(() =>
      verifyDiscordInteractionSignature({
        body: JSON.stringify({ type: 2 }),
        timestamp,
        signature,
        publicKey: keys.publicKey,
      }),
    ).toThrow("Discord interaction signature is invalid");
    expect(() =>
      verifyDiscordInteractionSignature({
        body,
        timestamp,
        signature: "not-hex",
        publicKey: keys.publicKey,
      }),
    ).toThrow("Discord interaction signature is invalid");
  });

  it("returns private response data without allowing mentions", async () => {
    const response = discordInteractionResponse("Prepared for review.", {
      ephemeral: true,
    });

    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Prepared for review.",
        allowed_mentions: { parse: [] },
        flags: 64,
      },
    });
  });
});
