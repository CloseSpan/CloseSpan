import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubInstallCompletionToken } from "@/lib/github-installation-state";
import Page from "./page";

const secret = "github-result-test-secret-with-at-least-32-characters";
const channel = "11111111-1111-4111-8111-111111111111";

describe("GitHub popup result page", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("publishes the verified channel and result without exposing the receipt", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    const receipt = createGithubInstallCompletionToken({ channel, status: "connected", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ receipt }) }));
    expect(markup).toContain("GitHub connected");
    expect(markup).toContain(`data-channel="${channel}"`);
    expect(markup).toContain('data-status="connected"');
    expect(markup).toContain("Close window");
    expect(markup).not.toContain(receipt);
  });

  it("does not publish completion data for a forged or expired receipt", async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    const receipt = createGithubInstallCompletionToken({ channel, status: "connected", expiresAt: new Date(Date.now() - 1).toISOString() });
    for (const invalid of [`${receipt}forged`, receipt]) {
      const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ receipt: invalid }) }));
      expect(markup).toContain("GitHub connection incomplete");
      expect(markup).not.toContain("data-channel=");
      expect(markup).not.toContain("data-status=");
    }
  });
});
