import { type NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authentication = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("@/auth", () => ({ auth: () => authentication.handle }));

import { config, proxy } from "./proxy";

describe("app domain proxy", () => {
  const event = {} as NextFetchEvent;

  beforeEach(() => {
    vi.stubEnv("CLOSESPAN_UI_RESET", "false");
    vi.stubEnv("CLOSESPAN_APP_DOMAIN_ENABLED", "true");
    authentication.handle.mockReset().mockImplementation(() => NextResponse.next());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects the original public host before authentication can normalize the URL", async () => {
    const response = await proxy(
      new NextRequest("https://www.closespan.com/overview?range=30d"), event,
    );

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://app.closespan.com/overview?range=30d");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(authentication.handle).not.toHaveBeenCalled();
  });

  it("delegates app authentication and preserves its response with noindex headers", async () => {
    const request = new NextRequest("https://app.closespan.com/overview");
    const authResponse = NextResponse.redirect(new URL("/login", request.url));
    authentication.handle.mockResolvedValue(authResponse);

    const response = await proxy(request, event);

    expect(authentication.handle).toHaveBeenCalledWith(request, event);
    expect(response).toBe(authResponse);
    expect(response?.headers.get("location")).toBe("https://app.closespan.com/login");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("marks authenticated app pages as noindex", async () => {
    const response = await proxy(new NextRequest("https://app.closespan.com/settings"), event);

    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("serves an app robots disallow response before authentication", async () => {
    const response = await proxy(new NextRequest("https://app.closespan.com/robots.txt"), event);

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response?.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(authentication.handle).not.toHaveBeenCalled();
  });

  it.each(["false", ""])("preserves existing behavior when the rollout flag is %s", async (value) => {
    vi.stubEnv("CLOSESPAN_APP_DOMAIN_ENABLED", value);

    for (const url of ["https://www.closespan.com/overview", "https://app.closespan.com/", "https://app.closespan.com/robots.txt"]) {
      const response = await proxy(new NextRequest(url), event);
      expect(response?.headers.get("location")).toBeNull();
      expect(response?.headers.get("x-robots-tag")).toBeNull();
      expect(response?.headers.get("x-middleware-next")).toBe("1");
    }
    expect(authentication.handle).toHaveBeenCalledTimes(3);
  });

  it.each([
    "https://www.closespan.com/about",
    "https://www.closespan.com/robots.txt",
    "http://localhost:3000/overview",
    "https://preview.vercel.app/overview",
    "https://unknown.example/overview",
    "https://www.closespan.com/github/connection-result?channel=opaque",
  ])("delegates unchanged navigation to authentication for %s", async (url) => {
    const request = new NextRequest(url);
    const response = await proxy(request, event);

    expect(authentication.handle).toHaveBeenCalledWith(request, event);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-robots-tag")).toBeNull();
  });

  it("does not replay POST navigation on another host", async () => {
    const request = new NextRequest("https://www.closespan.com/settings", {
      method: "POST", body: "opaque-form-body",
    });
    const response = await proxy(request, event);

    expect(authentication.handle).toHaveBeenCalledWith(request, event);
    expect(response?.headers.get("location")).toBeNull();
  });

  it.each(["/api/auth/callback/google", "/api/integrations/github/callback", "/api/webhooks/github"])(
    "excludes API route %s from proxy execution",
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://www.closespan.com${path}` })).toBe(false);
    },
  );

  it("matches protected pages and the app robots route", () => {
    for (const path of ["/overview", "/settings", "/robots.txt"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://app.closespan.com${path}` })).toBe(true);
    }
  });
});

describe("local UI reset proxy", () => {
  const event = {} as NextFetchEvent;
  beforeEach(() => {
    vi.stubEnv("CLOSESPAN_APP_DOMAIN_ENABLED", "false");
    vi.stubEnv("CLOSESPAN_UI_RESET", "true");
    vi.stubEnv("NODE_ENV", "development");
    authentication.handle.mockReset().mockImplementation(() => NextResponse.next());
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["GET", "HEAD"])("preserves %s homepage navigation while the workspace reset is enabled", async (method) => {
    const request = new NextRequest("http://localhost:3000/?utm_source=demo", { method });
    const authResponse = NextResponse.next();
    authentication.handle.mockResolvedValue(authResponse);

    const response = await proxy(request, event);

    expect(authentication.handle).toHaveBeenCalledWith(request, event);
    expect(response).toBe(authResponse);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(request.nextUrl.search).toBe("?utm_source=demo");
  });

  it.each(["GET", "HEAD"])("preserves %s public requests navigation while the workspace reset is enabled", async (method) => {
    const request = new NextRequest("http://localhost:3000/requests?sort=recent", { method });
    const authResponse = NextResponse.next();
    authentication.handle.mockResolvedValue(authResponse);

    const response = await proxy(request, event);

    expect(authentication.handle).toHaveBeenCalledWith(request, event);
    expect(response).toBe(authResponse);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(request.nextUrl.search).toBe("?sort=recent");
  });

  it("preserves refreshed session cookies while redirecting an auth continuation", async () => {
    const authResponse = NextResponse.next();
    authResponse.cookies.set("authjs.session-token", "test-session", { httpOnly: true });
    authResponse.cookies.set("authjs.csrf-token", "test-csrf", { httpOnly: true });
    authentication.handle.mockResolvedValue(authResponse);
    const response = await proxy(new NextRequest("http://localhost:3000/problems/old?tab=details"), event);
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/workspace-reset");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("x-middleware-next")).toBeNull();
    expect(response?.headers.get("set-cookie")).toContain("authjs.session-token=test-session");
    expect(response?.headers.get("set-cookie")).toContain("authjs.csrf-token=test-csrf");
  });

  it.each([302, 401, 403, 500])("leaves auth responses with status %s untouched", async (status) => {
    const authResponse = new NextResponse(null, { status });
    authentication.handle.mockResolvedValue(authResponse);
    expect(await proxy(new NextRequest("http://localhost:3000/overview"), event)).toBe(authResponse);
  });

  it("retains the original loopback destination even if auth normalizes the URL", async () => {
    const request = new NextRequest("http://localhost:3000/overview");
    authentication.handle.mockImplementation(() => {
      request.nextUrl.hostname = "app.closespan.com";
      return NextResponse.next();
    });
    const response = await proxy(request, event);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/workspace-reset");
  });

  it("does not intercept server actions", async () => {
    const response = await proxy(new NextRequest("http://localhost:3000/settings", { method: "POST" }), event);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("x-middleware-next")).toBe("1");
  });
});
