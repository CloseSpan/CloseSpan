const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(jsonHeaders)) headers.set(name, value);
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export function withSecurityHeaders(response: Response, path: string): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  if (path === "/admin" || path.startsWith("/admin/")) secured.headers.set("x-robots-tag", "noindex, nofollow");
  return secured;
}

export async function boundedJson(request: Request, limit = 32_000): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new RequestError(413, "Request body is too large.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) throw new RequestError(413, "Request body is too large.");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
}

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RequestError";
  }
}
