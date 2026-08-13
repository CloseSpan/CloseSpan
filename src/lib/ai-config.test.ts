import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiRuntimeConfiguration } from "./ai-config";

afterEach(() => vi.unstubAllEnvs());

describe("AI runtime environment fallback", () => {
  it("uses the server OPENAI_API_KEY when the workspace has no saved override", async () => {
    vi.stubEnv("PERSISTENCE_MODE", "memory");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "gpt-5.6-sol");
    vi.stubEnv("OPENAI_API_KEY", "server-openai-key");

    const configuration = await getAiRuntimeConfiguration("org-without-ai-override");

    expect(configuration).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol",
      configured: true,
      apiKey: "server-openai-key",
      keySource: "environment",
    });
  });
});
