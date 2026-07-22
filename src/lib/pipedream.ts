import { PipedreamClient } from "@pipedream/sdk";

export class PipedreamConfigurationError extends Error {
  constructor() {
    super("Pipedream Connect is not configured for this environment.");
    this.name = "PipedreamConfigurationError";
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new PipedreamConfigurationError();
  return value;
}

export function pipedreamExternalUserId(orgId: string): string {
  return `feelow:${orgId}`;
}

export function getPipedreamClient(): PipedreamClient {
  return new PipedreamClient({
    projectId: required("PIPEDREAM_PROJECT_ID"),
    clientId: required("PIPEDREAM_CLIENT_ID"),
    clientSecret: required("PIPEDREAM_CLIENT_SECRET"),
    projectEnvironment:
      (process.env.PIPEDREAM_PROJECT_ENVIRONMENT ?? process.env.PIPEDREAM_ENVIRONMENT)?.trim() === "production"
        ? "production"
        : "development",
  });
}

export function pipedreamConfigured(): boolean {
  return Boolean(
    process.env.PIPEDREAM_PROJECT_ID?.trim() &&
      process.env.PIPEDREAM_CLIENT_ID?.trim() &&
      process.env.PIPEDREAM_CLIENT_SECRET?.trim(),
  );
}
