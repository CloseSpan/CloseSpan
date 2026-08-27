"use client";

import { Boxes, CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AnimatedStatusText } from "./animated-status-text";

type CheckResult = {
  status: "ok";
  provider: "CreateOS Sandbox";
  sandboxId: string;
  executionDurationMs: number;
  totalDurationMs: number;
  checkedAt: string;
};

export function CreateosSandboxCheck({
  orgId,
  configured,
  isAdmin,
}: {
  orgId: string;
  configured: boolean;
  isAdmin: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch("/api/agent-execution/createos/test", {
        method: "POST",
        headers: {
          "x-org-id": orgId,
          "idempotency-key": `createos_test_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-request-id": crypto.randomUUID(),
        },
      });
      const body = (await response.json()) as Partial<CheckResult> & {
        error?: string;
      };
      if (!response.ok || body.status !== "ok") {
        throw new Error(body.error ?? "The CreateOS sandbox test could not run.");
      }
      setResult(body as CheckResult);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The CreateOS sandbox test could not run.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="callout section-gap-sm">
      <div className="split">
        <div>
          <div className="callout-title">
            <Boxes size={14} /> CreateOS Sandbox
          </div>
          <p className="subtle">
            Create a disposable Firecracker microVM and run one fixed offline
            verification command. Ingress stays off, external egress is
            restricted, and the sandbox is destroyed after every test.
          </p>
        </div>
        <span className={`badge ${configured ? "success" : "medium"}`}>
          {configured ? "Configured" : "Key required"}
        </span>
      </div>
      <div className="ai-config-actions section-gap-sm">
        <button
          type="button"
          className="btn primary"
          disabled={busy || !configured || !isAdmin}
          onClick={() => void runCheck()}
        >
          {busy ? (
            <AnimatedStatusText>Testing sandbox</AnimatedStatusText>
          ) : (
            <>
              <ShieldCheck size={14} aria-hidden="true" /> Test CreateOS sandbox
            </>
          )}
        </button>
        {!isAdmin && (
          <span className="subtle">Administrator permission is required.</span>
        )}
      </div>
      {result && (
        <div className="toast success" role="status">
          <div className="callout-title">
            <CheckCircle2 size={14} /> CreateOS sandbox is ready
          </div>
          Verified in {result.totalDurationMs.toLocaleString()} ms · command ran
          in {result.executionDurationMs.toLocaleString()} ms · sandbox{" "}
          <code>{result.sandboxId}</code> ·{" "}
          {new Date(result.checkedAt).toLocaleString()}
        </div>
      )}
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
