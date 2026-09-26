import { describe, expect, it } from "vitest";
import { appDomainRedirect, isWorkspacePage } from "./app-domain-routing";

function redirect(url: string, method = "GET", enabled = true) {
  return appDomainRedirect(new URL(url), method, enabled)?.href ?? null;
}

describe("app domain routing", () => {
  it.each([
    "https://closespan.com/overview",
    "https://www.closespan.com/login",
    "https://app.closespan.com/",
    "https://app.closespan.com/about",
  ])("leaves %s unchanged while disabled", (url) => {
    expect(redirect(url, "GET", false)).toBeNull();
  });

  it.each(["closespan.com", "www.closespan.com"])(
    "moves workspace navigation from %s and retains its path, query, and fragment",
    (host) => {
      expect(redirect(`https://${host}/problems/problem-123/?view=history#evidence`)).toBe(
        "https://app.closespan.com/problems/problem-123/?view=history#evidence",
      );
    },
  );

  it("moves login and HEAD navigation to the app", () => {
    expect(redirect("https://www.closespan.com/login?callbackUrl=%2Foverview", "HEAD")).toBe(
      "https://app.closespan.com/login?callbackUrl=%2Foverview",
    );
  });

  it.each(["zendesk", "intercom", "github"])(
    "keeps the exact public %s integration guide on the public site",
    (connector) => {
      expect(redirect(`https://www.closespan.com/integrations/${connector}`)).toBeNull();
      expect(redirect(`https://closespan.com/integrations/${connector}/`)).toBeNull();
      expect(redirect(`https://app.closespan.com/integrations/${connector}?source=app`)).toBe(
        `https://www.closespan.com/integrations/${connector}?source=app`,
      );
    },
  );

  it("recognizes workspace prefixes without treating guide descendants as public pages", () => {
    expect(isWorkspacePage("/integrations")).toBe(true);
    expect(isWorkspacePage("/integrations/github/settings")).toBe(true);
    expect(isWorkspacePage("/integrations-guide")).toBe(false);
    expect(isWorkspacePage("/overview-other")).toBe(false);
    expect(isWorkspacePage("/api/integrations/github")).toBe(false);
  });

  it("routes the app root and requests shortcut to their workspace destinations", () => {
    expect(redirect("https://app.closespan.com/?source=bookmark#summary")).toBe(
      "https://app.closespan.com/overview?source=bookmark#summary",
    );
    expect(redirect("https://app.closespan.com/requests/?status=open")).toBe(
      "https://app.closespan.com/admin/requests?status=open",
    );
    expect(redirect("https://www.closespan.com/requests")).toBeNull();
  });

  it("moves public app pages to the canonical site while preserving the query", () => {
    expect(redirect("https://app.closespan.com/about/?source=footer#team")).toBe(
      "https://www.closespan.com/about/?source=footer#team",
    );
  });

  it.each([
    "http://localhost:3000/overview",
    "http://127.0.0.1:3000/login",
    "https://closespan-preview.vercel.app/overview",
    "https://closespan.com.attacker.example/overview",
    "https://app.closespan.com.attacker.example/about",
    "https://other.example/overview",
  ])("does not redirect local, preview, or unknown host %s", (url) => {
    expect(redirect(url)).toBeNull();
  });

  it("never uses a query parameter as the redirect origin", () => {
    expect(redirect("https://closespan.com/login?callbackUrl=https%3A%2F%2Fattacker.example")).toBe(
      "https://app.closespan.com/login?callbackUrl=https%3A%2F%2Fattacker.example",
    );
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("does not redirect %s requests", (method) => {
    expect(redirect("https://closespan.com/settings", method)).toBeNull();
    expect(redirect("https://app.closespan.com/requests", method)).toBeNull();
  });

  it.each(["/api", "/api/auth/callback/google?code=opaque", "/api/integrations/github/callback"])(
    "keeps API path %s on the original host",
    (path) => {
      expect(redirect(`https://www.closespan.com${path}`)).toBeNull();
      expect(redirect(`https://app.closespan.com${path}`)).toBeNull();
    },
  );

  it.each(["closespan.com", "www.closespan.com", "app.closespan.com"])(
    "preserves the GitHub popup receipt origin on %s",
    (host) => {
      expect(redirect(`https://${host}/github/connection-result?channel=opaque`)).toBeNull();
    },
  );

  it("leaves workspace pages already on the app and unknown routes in place", () => {
    expect(redirect("https://app.closespan.com/overview")).toBeNull();
    expect(redirect("https://app.closespan.com/unknown-route")).toBeNull();
    expect(redirect("https://www.closespan.com/unknown-route")).toBeNull();
  });
});
