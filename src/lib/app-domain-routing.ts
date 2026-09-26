import { PRIVATE_APP_PATHS, PUBLIC_INDEXABLE_PATHS, SITE_URL } from "./site";

export const APP_ORIGIN = "https://app.closespan.com";
const PUBLIC_HOSTS = new Set(["closespan.com", "www.closespan.com"]);
const APP_HOST = new URL(APP_ORIGIN).hostname;
const PUBLIC_PAGES = new Set<string>(PUBLIC_INDEXABLE_PATHS);

export function isAppHostname(hostname: string): boolean {
  return hostname === APP_HOST;
}

export function isWorkspacePage(pathname: string): boolean {
  // Public connector guides share the /integrations prefix with the workspace.
  if (PUBLIC_PAGES.has(pathname)) return false;
  return PRIVATE_APP_PATHS.some((prefix) =>
    prefix !== "/api/" && (pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

/** Only navigation moves hosts. Never replay POST bodies or OAuth/webhook APIs. */
export function appDomainRedirect(
  url: URL,
  method: string,
  enabled: boolean,
): URL | null {
  if (!enabled || (method !== "GET" && method !== "HEAD")) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;

  const path = url.pathname.replace(/\/$/, "") || "/";
  // A signed popup receipt must reach the opener's localStorage origin, including
  // installations started on the public host shortly before the cutover.
  if (path === "/github/connection-result") return null;
  if (PUBLIC_HOSTS.has(url.hostname) && isWorkspacePage(path)) {
    const target = new URL(APP_ORIGIN);
    target.pathname = url.pathname;
    target.search = url.search;
    target.hash = url.hash;
    return target;
  }

  if (!isAppHostname(url.hostname)) return null;
  if (path === "/" || path === "/requests") {
    const target = new URL(APP_ORIGIN);
    target.pathname = path === "/" ? "/overview" : "/admin/requests";
    target.search = url.search;
    target.hash = url.hash;
    return target;
  }
  if (PUBLIC_PAGES.has(path)) {
    const target = new URL(SITE_URL);
    target.pathname = url.pathname;
    target.search = url.search;
    target.hash = url.hash;
    return target;
  }
  // Localhost, previews, assets, unknown routes, and app APIs stay on their host.
  return null;
}
