"use client";

import { useEffect } from "react";
import type { GithubInstallCompletion } from "@/lib/github-installation-state";
import { GITHUB_POPUP_RESULT_PREFIX, githubPopupFailureMessage } from "@/lib/github-installation-client";

export function GithubConnectionResult({ completion }: { completion: GithubInstallCompletion | null }) {
  useEffect(() => {
    if (!completion || Date.parse(completion.expiresAt) <= Date.now()) return;
    const key = `${GITHUB_POPUP_RESULT_PREFIX}${completion.channel}`;
    try { window.localStorage.setItem(key, JSON.stringify(completion)); } catch { /* Parent can also read the verified DOM on this origin. */ }
    // Clean up even when the initiating window was closed or reloaded.
    const expiry = setTimeout(() => { try { window.localStorage.removeItem(key); } catch { /* Optional storage. */ } }, Math.max(0, Date.parse(completion.expiresAt) - Date.now()));
    return () => clearTimeout(expiry);
  }, [completion]);

  const connected = completion?.status === "connected";
  return (
    <main className="auth-page">
      <section className="card" id="github-connection-result" data-channel={completion?.channel} data-status={completion?.status} data-reason={completion?.reason} data-expires-at={completion?.expiresAt}>
        <div className="card-body">
          <h1>{connected ? "GitHub connected" : "GitHub connection incomplete"}</h1>
          <p>{connected ? "You can close this window and return to CloseSpan." : githubPopupFailureMessage(completion?.reason)}</p>
          <button type="button" className="btn primary" onClick={() => window.close()}>Close window</button>
        </div>
      </section>
    </main>
  );
}
