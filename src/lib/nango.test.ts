import { describe, expect, it } from "vitest";
import {
  getNangoApiKey,
  getNangoEnvironmentName,
  getNangoHost,
  getNangoWebhookSigningKey,
  NangoConfigurationError,
  resolveNangoProviderConfigKey,
} from "./nango";

function environment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides };
}

describe("Nango environment configuration", () => {
  it("prefers and trims the current API key variable in every environment", () => {
    expect(
      getNangoApiKey(environment({
        APP_MODE: "production",
        NANGO_API_KEY: "  current-key  ",
        NANGO_SECRET_KEY_PROD: "legacy-production-key",
        NANGO_SECRET_KEY_DEV: "legacy-development-key",
      })),
    ).toBe("current-key");
  });

  it("uses only the production compatibility key in production", () => {
    expect(
      getNangoApiKey(environment({
        APP_MODE: "production",
        NANGO_SECRET_KEY_PROD: "production-key",
        NANGO_SECRET_KEY_DEV: "development-key",
      })),
    ).toBe("production-key");
    expect(
      getNangoApiKey(environment({
        NODE_ENV: "production",
        NANGO_SECRET_KEY_DEV: "development-key",
      })),
    ).toBeNull();
  });

  it("uses only the development compatibility key outside production", () => {
    expect(
      getNangoApiKey(environment({
        NODE_ENV: "development",
        NANGO_SECRET_KEY_PROD: "production-key",
        NANGO_SECRET_KEY_DEV: "development-key",
      })),
    ).toBe("development-key");
    expect(
      getNangoApiKey(environment({
        APP_MODE: "demo",
        NODE_ENV: "production",
        NANGO_SECRET_KEY_PROD: "production-key",
      })),
    ).toBeNull();
  });

  it("treats blank secrets as unconfigured and keeps the webhook key distinct", () => {
    expect(getNangoApiKey(environment({ NANGO_API_KEY: "  " }))).toBeNull();
    expect(
      getNangoWebhookSigningKey(
        environment({ NANGO_WEBHOOK_SIGNING_KEY: "  webhook  " }),
      ),
    ).toBe("webhook");
    expect(
      getNangoWebhookSigningKey(
        environment({ NANGO_WEBHOOK_SIGNING_KEY: " " }),
      ),
    ).toBeNull();
  });

  it("classifies explicit production and demo modes deterministically", () => {
    expect(getNangoEnvironmentName(environment({ APP_MODE: "production" }))).toBe(
      "PROD",
    );
    expect(
      getNangoEnvironmentName(
        environment({ APP_MODE: "demo", NODE_ENV: "production" }),
      ),
    ).toBe("DEV");
    expect(
      getNangoEnvironmentName(environment({ NODE_ENV: "development" })),
    ).toBe(
      "DEV",
    );
    expect(
      getNangoEnvironmentName(
        environment({ NANGO_ENVIRONMENT: " staging " }),
      ),
    ).toBe("STAGING");
    expect(
      getNangoApiKey(
        environment({
          NANGO_ENVIRONMENT: "staging",
          NANGO_SECRET_KEY_STAGING: "staging-key",
        }),
      ),
    ).toBe("staging-key");
    expect(() =>
      getNangoEnvironmentName(
        environment({ NANGO_ENVIRONMENT: "invalid environment" }),
      ),
    ).toThrow(NangoConfigurationError);
  });

  it("normalizes an optional HTTP(S) host and rejects invalid protocols", () => {
    expect(getNangoHost(environment())).toBeUndefined();
    expect(
      getNangoHost(environment({ NANGO_HOST: " https://api.nango.dev/ " })),
    ).toBe(
      "https://api.nango.dev",
    );
    expect(
      getNangoHost(
        environment({ NANGO_HOST: "http://nango.internal:3003/" }),
      ),
    ).toBe(
      "http://nango.internal:3003",
    );

    for (const host of ["api.nango.dev", "ftp://api.nango.dev", "not a url"]) {
      expect(() => getNangoHost(environment({ NANGO_HOST: host }))).toThrow(
        NangoConfigurationError,
      );
    }
  });
});

describe("Nango provider configuration allowlist", () => {
  it.each([
    ["int_zendesk", "zendesk"],
    ["int_intercom", "intercom"],
    ["int_slack", "slack"],
    ["int_app_store", "apple-app-store"],
    ["int_play_store", "google-play"],
    ["int_github", "github-getting-started"],
  ])("maps %s to the default key %s", (integrationId, expected) => {
    expect(resolveNangoProviderConfigKey(integrationId, environment())).toBe(
      expected,
    );
  });

  it.each([
    ["int_zendesk", "NANGO_ZENDESK_INTEGRATION_ID"],
    ["int_intercom", "NANGO_INTERCOM_INTEGRATION_ID"],
    ["int_slack", "NANGO_SLACK_INTEGRATION_ID"],
    ["int_app_store", "NANGO_APP_STORE_INTEGRATION_ID"],
    ["int_play_store", "NANGO_GOOGLE_PLAY_INTEGRATION_ID"],
    ["int_github", "NANGO_GITHUB_INTEGRATION_ID"],
  ])("uses the isolated override for %s", (integrationId, variableName) => {
    expect(
      resolveNangoProviderConfigKey(
        integrationId,
        environment({ [variableName]: "  tenant-safe_key.v2  " }),
      ),
    ).toBe("tenant-safe_key.v2");
  });

  it("rejects unknown integrations before reading provider configuration", () => {
    expect(() =>
      resolveNangoProviderConfigKey(
        "int_custom_webhook",
        environment({ NANGO_GITHUB_INTEGRATION_ID: "github" }),
      ),
    ).toThrow(/not available through Nango/);
  });

  it.each([
    "contains spaces",
    "contains/slash",
    "_starts-with-punctuation",
    `${"a".repeat(129)}`,
  ])("rejects invalid provider key %j", (providerKey) => {
    expect(() =>
      resolveNangoProviderConfigKey(
        "int_github",
        environment({ NANGO_GITHUB_INTEGRATION_ID: providerKey }),
      ),
    ).toThrow(NangoConfigurationError);
  });
});
