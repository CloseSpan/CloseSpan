export async function requestGithubInstallUrl(
  orgId: string,
  options: { returnTo?: "/onboarding" } = {},
): Promise<string> {
  const response = await fetch("/api/integrations/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: Object.keys(options).length > 0 ? JSON.stringify(options) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    installUrl?: unknown;
  };
  if (!response.ok || typeof payload.installUrl !== "string") {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "GitHub connection could not be started",
    );
  }
  return payload.installUrl;
}
