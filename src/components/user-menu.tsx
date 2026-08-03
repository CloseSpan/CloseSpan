"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

type MenuPhase = "closed" | "opening" | "open" | "closing";

const CLOSE_DURATION_MS = 190;

export function UserMenu({
  label,
  avatar,
  children,
}: {
  label: string;
  avatar: string;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<MenuPhase>("closed");
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panelId = useId();
  const rendered = phase !== "closed";
  const expanded = phase === "opening" || phase === "open";

  function clearScheduledClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openMenu() {
    clearScheduledClose();
    setPhase("opening");
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!rendered || phase === "closing") return;

    clearScheduledClose();
    if (reduceMotion) {
      setPhase("closed");
      if (restoreFocus) triggerRef.current?.focus();
      return;
    }
    setPhase("closing");
    closeTimerRef.current = window.setTimeout(() => {
      setPhase("closed");
      closeTimerRef.current = null;
      if (restoreFocus) triggerRef.current?.focus();
    }, CLOSE_DURATION_MS);
  }

  useEffect(() => {
    if (phase !== "opening") return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setPhase("open");
        animationFrameRef.current = null;
      });
    });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => {
    if (!rendered) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu({ restoreFocus: true });
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  useEffect(
    () => () => {
      clearScheduledClose();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={rendered ? panelId : undefined}
        onClick={() => (expanded ? closeMenu() : openMenu())}
      >
        <span className="avatar" aria-hidden="true">
          {avatar}
        </span>
      </button>
      {rendered ? (
        <div
          id={panelId}
          className="user-menu-panel"
          data-state={phase}
          aria-hidden={phase === "closing"}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
