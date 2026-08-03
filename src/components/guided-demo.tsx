"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  MapPinned,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceDemoGuide } from "@/lib/demo-guide-repository";
import { resolveDemoGuideStepIndex } from "@/lib/demo-guide-navigation";
import { FitText } from "./fit-text";

export function GuidedDemo({
  guide,
  orgId,
}: {
  guide: WorkspaceDemoGuide;
  orgId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const storageKey = useMemo(() => `closespan-demo-guide:${orgId}`, [orgId]);
  const step = guide.steps[stepIndex] ?? guide.steps[0];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = Number(window.localStorage.getItem(`${storageKey}:step`));
      const initialIndex = resolveDemoGuideStepIndex(
        guide.steps,
        pathname,
        stored,
      );
      setStepIndex(initialIndex);
      if (!window.localStorage.getItem(`${storageKey}:seen`)) {
        setOpen(true);
        window.localStorage.setItem(`${storageKey}:seen`, "true");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [guide.steps, pathname, storageKey]);

  function selectStep(index: number, navigate = true) {
    const bounded = Math.max(0, Math.min(guide.steps.length - 1, index));
    setStepIndex(bounded);
    setNotice(null);
    window.localStorage.setItem(`${storageKey}:step`, String(bounded));
    if (navigate) router.push(guide.steps[bounded]?.path ?? "/overview");
  }

  async function resetDemo() {
    if (resetting) return;
    setResetting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: {
          "x-org-id": orgId,
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
      });
      if (!response.ok) throw new Error("reset_failed");
      setResetConfirmation(false);
      selectStep(0);
      setNotice({
        message: "Demo workflow restored to its starting point.",
        tone: "success",
      });
      router.refresh();
    } catch {
      setNotice({
        message: "The demo could not be reset right now. Try again shortly.",
        tone: "error",
      });
    } finally {
      setResetting(false);
    }
  }

  if (!step) return null;
  const progress = ((stepIndex + 1) / guide.steps.length) * 100;
  const onStepPage = pathname === step.path;

  return (
    <>
      {open && (
        <aside className="guided-demo-panel" aria-label="Guided product demo">
          <header className="guided-demo-head">
            <span className="guided-demo-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <small>Presentation mode</small>
              <FitText as="strong" minFontSize={11} maxLines={1}>
                {guide.title}
              </FitText>
            </div>
            <button
              type="button"
              aria-label="Close guided demo"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="guided-demo-progress" aria-label={`Step ${stepIndex + 1} of ${guide.steps.length}`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="guided-demo-body">
            <div className="guided-demo-step-label">
              Step {stepIndex + 1} of {guide.steps.length}
            </div>
            <FitText as="h2" minFontSize={16} maxLines={2}>
              {step.title}
            </FitText>
            <p>{step.description}</p>
            {step.talkingPoints.length > 0 && (
              <ul>
                {step.talkingPoints.map((point) => (
                  <li key={point}>
                    <Check size={13} aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
            {!onStepPage && (
              <button
                className="guided-demo-open-view"
                type="button"
                onClick={() => router.push(step.path)}
              >
                {step.actionLabel} <ChevronRight size={14} />
              </button>
            )}
            {notice && (
              <p
                className="guided-demo-notice"
                data-tone={notice.tone}
                role={notice.tone === "error" ? "alert" : "status"}
              >
                {notice.message}
              </p>
            )}
          </div>
          <footer className="guided-demo-footer">
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={() => selectStep(stepIndex - 1)}
            >
              <ChevronLeft size={14} /> Back
            </button>
            {stepIndex < guide.steps.length - 1 ? (
              <button
                className="primary"
                type="button"
                onClick={() => selectStep(stepIndex + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            ) : (
              <button className="primary" type="button" onClick={() => setOpen(false)}>
                Finish
              </button>
            )}
          </footer>
          <div className="guided-demo-reset">
            {resetConfirmation ? (
              <div>
                <span>Restore the approval workflow to the beginning?</span>
                <button type="button" onClick={() => setResetConfirmation(false)}>Cancel</button>
                <button type="button" disabled={resetting} onClick={() => void resetDemo()}>
                  {resetting ? "Resetting…" : "Restore"}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setResetConfirmation(true)}>
                <RotateCcw size={12} /> Reset walkthrough data
              </button>
            )}
          </div>
        </aside>
      )}
      <button
        className="guided-demo-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MapPinned size={16} aria-hidden="true" />
        <span>Guided demo</span>
        <small>{stepIndex + 1}/{guide.steps.length}</small>
      </button>
    </>
  );
}
