"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/lib/turnstile-config";

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme: "auto";
  size: "flexible";
  appearance: "interaction-only";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": (code: string) => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: TurnstileRenderOptions,
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  siteKey,
  action,
  resetKey,
  onTokenChange,
}: {
  siteKey: string;
  action: TurnstileAction;
  resetKey: number;
  onTokenChange: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const previousResetKeyRef = useRef(resetKey);
  const [apiReady, setApiReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "unavailable"
  >(siteKey ? "loading" : "unavailable");

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    const api = window.turnstile;
    const container = containerRef.current;
    if (!siteKey || !apiReady || !api || !container) return;

    setStatus("loading");
    onTokenChangeRef.current(null);
    widgetIdRef.current = api.render(container, {
      sitekey: siteKey,
      action,
      theme: "auto",
      size: "flexible",
      appearance: "interaction-only",
      callback: (token) => {
        setStatus("ready");
        onTokenChangeRef.current(token);
      },
      "expired-callback": () => {
        setStatus("loading");
        onTokenChangeRef.current(null);
      },
      "timeout-callback": () => {
        setStatus("loading");
        onTokenChangeRef.current(null);
      },
      "error-callback": () => {
        setStatus("error");
        onTokenChangeRef.current(null);
      },
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, apiReady, siteKey]);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    if (!widgetIdRef.current || !window.turnstile) return;
    setStatus("loading");
    onTokenChangeRef.current(null);
    window.turnstile.reset(widgetIdRef.current);
  }, [resetKey]);

  if (!siteKey) {
    return (
      <p className="turnstile-unavailable" role="alert">
        Security verification is temporarily unavailable. Please try again
        shortly.
      </p>
    );
  }

  return (
    <>
      <div className="turnstile-challenge" hidden={status === "ready"}>
        <Script
          id="cloudflare-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setApiReady(true)}
          onError={() => {
            setStatus("error");
            onTokenChangeRef.current(null);
          }}
        />
        <div ref={containerRef} />
        {status === "loading" && (
          <p className="turnstile-status" aria-hidden="true">
            <span>Checking browser security</span>
            <span className="turnstile-status-dots">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}
        {status === "error" && (
          <p className="turnstile-unavailable" role="alert">
            Security verification could not finish. Refresh and try again.
          </p>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "ready"
          ? "Security check complete."
          : status === "error"
            ? "Security check could not finish. Refresh and try again."
            : "Checking browser security."}
      </span>
    </>
  );
}
