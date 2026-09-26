import { type NextFetchEvent, type NextMiddleware, type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { appDomainRedirect, isAppHostname } from "@/lib/app-domain-routing";
import { workspaceUiResetRedirect } from "@/lib/workspace-ui-reset";

const continueRequest: NextMiddleware = () => NextResponse.next();
const authenticatedProxy = auth(continueRequest);

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const enabled = process.env.CLOSESPAN_APP_DOMAIN_ENABLED === "true";
  // Use the incoming host before Auth.js normalizes its URL with AUTH_URL.
  const destination = appDomainRedirect(request.nextUrl, request.method, enabled);
  if (destination) {
    // Temporary, uncached redirects make a staged cutover safely reversible.
    const response = NextResponse.redirect(destination, 307);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  if (enabled && isAppHostname(request.nextUrl.hostname) && request.nextUrl.pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const resetDestination = workspaceUiResetRedirect(request.nextUrl, request.method);
  const response = await authenticatedProxy(request, event);
  // Keep auth denials/redirects intact. Public entry routes also reach this point;
  // the reset page itself still requires an authenticated workspace membership.
  if (resetDestination && response?.headers.get("x-middleware-next") === "1") {
    const headers = new Headers(response.headers);
    headers.delete("x-middleware-next");
    headers.set("Cache-Control", "private, no-store");
    return NextResponse.redirect(resetDestination, { status: 307, headers });
  }
  if (response && enabled && isAppHostname(request.nextUrl.hostname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
