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
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const panelId = useId();
  const panelTitleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (trigger?.isConnected) {
        window.requestAnimationFrame(() => {
          trigger.focus({ preventScroll: true });
        });
      }
    };
  }, [open]);

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
        <aside
          ref={panelRef}
          id={panelId}
          className="guided-demo-panel"
          role="dialog"
          aria-labelledby={panelTitleId}
        >
          <header className="guided-demo-head">
            <span className="guided-demo-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <small>Presentation mode</small>
              <FitText
                as="strong"
                id={panelTitleId}
                minFontSize={12}
                maxLines={1}
              >
                {guide.title}
              </FitText>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close guided demo"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <div
            className="guided-demo-progress"
            role="progressbar"
            aria-label="Guided demo progress"
            aria-valuemin={1}
            aria-valuemax={guide.steps.length}
            aria-valuenow={stepIndex + 1}
          >
            <span style={{ transform: `scaleX(${progress / 100})` }} />
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
        ref={triggerRef}
        className="guided-demo-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <MapPinned size={16} aria-hidden="true" />
        <span>Guided demo</span>
        <small>{stepIndex + 1}/{guide.steps.length}</small>
      </button>
    </>
  );
}
