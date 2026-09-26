import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceUiResetEnabled, workspaceUiResetRedirect } from "./workspace-ui-reset";

describe("local workspace reset", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLOSESPAN_UI_RESET", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["/overview", "/problems/id", "/onboarding", "/settings/appearance", "/approvals", "/pdd", "/agent-runs/id", "/feedback", "/customers", "/integrations", "/admin/requests", "/follow-up", "/notifications"])(
    "hides the legacy %s route for GET and HEAD without carrying old query data", (path) => {
      for (const method of ["GET", "HEAD"]) {
        expect(workspaceUiResetRedirect(new URL(`http://localhost:3000${path}?old=id`), method)?.href)
          .toBe("http://localhost:3000/workspace-reset");
      }
    },
  );

  it.each(["/", "/requests", "/requests/", "/workspace-reset", "/login", "/login/", "/waitlist", "/github/connection-result", "/api/auth/callback/google", "/api/webhooks/github", "/_next/static/a.js", "/integrations/github", "/privacy"])(
    "preserves authentication, static, and public route %s", (path) => {
      expect(workspaceUiResetRedirect(new URL(`http://localhost:3000${path}`), "GET")).toBeNull();
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])("permits exact loopback host %s", (hostname) => {
    expect(workspaceUiResetEnabled(hostname)).toBe(true);
  });

  it.each(["app.closespan.com", "closespan.com", "preview.vercel.app", "localhost.example.com", "notlocalhost", ""])("rejects non-loopback host %s", (hostname) => {
    expect(workspaceUiResetEnabled(hostname)).toBe(false);
  });

  it.each(["production", "test"])("is disabled in %s even with the flag set", (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    expect(workspaceUiResetEnabled("localhost")).toBe(false);
  });

  it.each(["false", ""])("is disabled with flag %s", (flag) => {
    vi.stubEnv("CLOSESPAN_UI_RESET", flag);
    expect(workspaceUiResetEnabled("localhost")).toBe(false);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("never redirects %s requests", (method) => {
    expect(workspaceUiResetRedirect(new URL("http://localhost:3000/settings"), method)).toBeNull();
  });
});
