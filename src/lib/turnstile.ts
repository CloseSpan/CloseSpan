import { z } from "zod";
import { HttpError } from "./request-security";
import {
  TURNSTILE_TEST_SITE_KEY,
  type TurnstileAction,
} from "./turnstile-config";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8_000;

export const TURNSTILE_TEST_SECRET_KEY =
  "1x0000000000000000000000000000000AA";

const siteverifyResponseSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().optional(),
    action: z.string().optional(),
    "error-codes": z.array(z.string()).optional(),
  })
  .passthrough();

function isProductionMode(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

function configuredSecretKey(): string {
  const configured = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (configured) return configured;
  if (!isProductionMode()) return TURNSTILE_TEST_SECRET_KEY;
  throw new HttpError(
    503,
    "Security verification is temporarily unavailable",
  );
}

function configuredExpectedHostname(): string | null {
  const configured =
    process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase() ?? "";
  if (configured) return configured;
  if (!isProductionMode()) return null;
  throw new HttpError(
    503,
    "Security verification is temporarily unavailable",
  );
}

export function turnstileSiteKey(): string {
  const configured =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  if (configured) return configured;
  return isProductionMode() ? "" : TURNSTILE_TEST_SITE_KEY;
}

export async function verifyTurnstileToken(
  token: string,
  expectedAction: TurnstileAction,
  remoteIp?: string | null,
): Promise<void> {
  const normalizedToken = token.trim();
  if (!normalizedToken || normalizedToken.length > 2_048) {
    throw new HttpError(400, "Complete the security check and try again");
  }

  const secret = configuredSecretKey();
  const expectedHostname = configuredExpectedHostname();
  const production = isProductionMode();
  const usesTestSecret = secret === TURNSTILE_TEST_SECRET_KEY;
  if (production && usesTestSecret) {
    throw new HttpError(
      503,
      "Security verification is temporarily unavailable",
    );
  }

  const body = new URLSearchParams({
    secret,
    response: normalizedToken,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Turnstile Siteverify returned ${response.status}`);
    }

    const parsed = siteverifyResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Turnstile Siteverify returned an invalid response");
    }

    const result = parsed.data;
    if (!result.success) {
      console.warn("Turnstile verification rejected a request", {
        errorCodes: result["error-codes"] ?? [],
        expectedAction,
      });
      throw new HttpError(403, "Security verification failed. Try again.");
    }

    // Cloudflare's documented dummy key response uses action="test" and
    // hostname="localhost". That response is accepted only outside production.
    if (!usesTestSecret || production) {
      if (result.action !== expectedAction) {
        console.warn("Turnstile action mismatch", {
          expectedAction,
          receivedAction: result.action ?? null,
        });
        throw new HttpError(403, "Security verification failed. Try again.");
      }
      if (
        expectedHostname &&
        result.hostname?.toLowerCase() !== expectedHostname
      ) {
        console.warn("Turnstile hostname mismatch", {
          expectedHostname,
          receivedHostname: result.hostname ?? null,
        });
        throw new HttpError(403, "Security verification failed. Try again.");
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(
      "Turnstile verification is unavailable",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new HttpError(
      503,
      "Security verification is temporarily unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}
