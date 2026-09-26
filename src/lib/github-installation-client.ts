export const GITHUB_POPUP_RESULT_PREFIX = "closespan:github-install:";
const POPUP_TIMEOUT_MS = 10 * 60_000;

export function githubPopupFailureMessage(reason?: string): string {
  const messages: Record<string, string> = {
    authentication_required: "Your session expired. Sign in again, then reconnect GitHub.",
    administrator_required: "Administrator permission is required to connect GitHub.",
    install_request_expired: "GitHub setup expired. Please try connecting again.",
    installation_unavailable: "This GitHub installation is unavailable. Please try again.",
    invalid_callback: "GitHub could not verify this connection. Please try again.",
  };
  return messages[reason ?? ""] ?? "GitHub connection failed. Please try again.";
}

export async function requestGithubInstallUrl(
  orgId: string,
  options: { returnTo?: "/onboarding"; popup?: boolean; popupChannel?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const { signal, ...requestOptions } = options;
  const response = await fetch("/api/integrations/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: Object.keys(requestOptions).length > 0 ? JSON.stringify(requestOptions) : undefined,
    ...(signal ? { signal } : {}),
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

/** Opens synchronously so the browser associates the popup with the user's click. */
export async function startGithubInstallationPopup(
  orgId: string,
  options: { returnTo?: "/onboarding"; signal?: AbortSignal } = {},
): Promise<void> {
  if (options.signal?.aborted) throw new DOMException("GitHub connection cancelled", "AbortError");
  const channel = crypto.randomUUID();
  const storageKey = `${GITHUB_POPUP_RESULT_PREFIX}${channel}`;
  const popup = window.open("about:blank", `closespan-github-${channel}`, "popup=yes,width=760,height=800");
  if (!popup) throw new Error("Allow pop-ups for CloseSpan, then try connecting GitHub again.");
  // Keep the parent reference for polling, but give GitHub no access to our window.
  try { popup.opener = null; } catch { popup.close(); throw new Error("Could not secure the GitHub window. Please try again."); }
  try { window.localStorage.removeItem(storageKey); } catch { /* URL polling also works without storage. */ }

  return new Promise<void>((resolve, reject) => {
    const requestController = new AbortController();
    let externalNavigationStarted = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      requestController.abort();
      try { popup.close(); } catch { /* COOP can detach the popup reference. */ }
      try { window.localStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(new DOMException("GitHub connection cancelled", "AbortError"));
    const consume = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const result = value as { channel?: unknown; status?: unknown; reason?: unknown; expiresAt?: unknown };
      if (result.channel !== channel || (result.status !== "connected" && result.status !== "error") ||
        typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) return;
      finish(result.status === "connected" ? undefined : new Error(githubPopupFailureMessage(typeof result.reason === "string" ? result.reason : undefined)));
    };
    const check = () => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) consume(JSON.parse(stored));
      } catch { /* Blocked storage or malformed unrelated data must not complete setup. */ }
      if (settled) return;
      try {
        if (popup.closed) {
          // After navigation COOP and an actual closed window are indistinguishable.
          // The signed same-origin result channel survives COOP; Cancel/timeout
          // remain reliable instead of incorrectly abandoning a live installation.
          if (!externalNavigationStarted) finish(new Error("The GitHub window was closed. Please try again."));
          return;
        }
        const url = new URL(popup.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === "/github/connection-result") {
          const result = popup.document.getElementById("github-connection-result");
          if (result) consume({ channel: result.dataset.channel, status: result.dataset.status, reason: result.dataset.reason, expiresAt: result.dataset.expiresAt });
        } else if (["/integrations", "/onboarding"].includes(url.pathname) && url.searchParams.get("github") === "error") {
          // Invalid/expired signed state deliberately retains the legacy failure
          // redirect. It may reject this flow, but never authenticate success.
          finish(new Error(githubPopupFailureMessage(url.searchParams.get("reason") ?? undefined)));
        }
      } catch { /* GitHub is cross-origin until it returns to our callback. */ }
    };
    const poll = setInterval(check, 300);
    const timeout = setTimeout(() => finish(new Error("GitHub setup timed out. Please try connecting again.")), POPUP_TIMEOUT_MS);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) { cancel(); return; }
    void requestGithubInstallUrl(orgId, { returnTo: options.returnTo, popup: true, popupChannel: channel, signal: requestController.signal })
      .then((installUrl) => {
        if (settled) return;
        let target: URL;
        try { target = new URL(installUrl); } catch { throw new Error("GitHub returned an invalid installation address. Please try again."); }
        if (target.origin !== "https://github.com" || target.username || target.password || target.hash || !/^\/apps\/[a-z\d_-]+\/installations\/new\/?$/i.test(target.pathname))
          throw new Error("GitHub returned an invalid installation address. Please try again.");
        if (popup.closed) throw new Error("The GitHub window was closed. Please try again.");
        externalNavigationStarted = true;
        popup.location.replace(target.toString());
      })
      .catch((error: unknown) => finish(error instanceof Error ? error : new Error("GitHub connection could not be started.")));
  });
}
