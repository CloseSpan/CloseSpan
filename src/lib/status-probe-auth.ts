async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export async function validStatusProbe(request: Request, expected = process.env.STATUS_PROBE_SECRET?.trim()): Promise<boolean> {
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const [providedHash, expectedHash] = await Promise.all([digest(provided), digest(expected)]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let index = 0; index < expectedBytes.length; index += 1)
    mismatch |= providedBytes[index]! ^ expectedBytes[index]!;
  return mismatch === 0;
}
