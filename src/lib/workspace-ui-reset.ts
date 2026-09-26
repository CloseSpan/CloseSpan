import { isWorkspacePage } from "./app-domain-routing";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const AUTH_PATHS = new Set(["/login", "/waitlist", "/github/connection-result"]);

/** A reversible local design reset; never enabled in production or on a remote host. */
export function workspaceUiResetEnabled(hostname: string): boolean {
  return process.env.NODE_ENV === "development"
    && process.env.CLOSESPAN_UI_RESET === "true"
    && LOOPBACK_HOSTS.has(hostname);
}

export function workspaceUiResetRedirect(url: URL, method: string): URL | null {
  if (!workspaceUiResetEnabled(url.hostname) || !["GET", "HEAD"].includes(method)) return null;
  const path = url.pathname.replace(/\/$/, "") || "/";
  // Public marketing and feature requests stay available during the workspace reset.
  if (path === "/" || path === "/requests" || AUTH_PATHS.has(path) || path === "/workspace-reset") return null;
  if (!isWorkspacePage(path)) return null;
  return new URL("/workspace-reset", url.origin);
}
