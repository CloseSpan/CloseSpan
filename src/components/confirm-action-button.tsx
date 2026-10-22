"use client";

import { Button } from "@/components/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Two-step inline confirmation for destructive one-click actions. The trigger
 * swaps for "{prompt} · Cancel · {confirmLabel}"; Escape or Cancel restores it.
 */
export function ConfirmActionButton({
  children,
  prompt,
  confirmLabel,
  onConfirm,
  disabled = false,
  className = "btn danger",
}: {
  children: ReactNode;
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <button ref={triggerRef} className={className} type="button" disabled={disabled} onClick={() => setConfirming(true)}>
        {children}
      </button>
    );
  }

  const cancel = () => {
    restoreFocus.current = true;
    setConfirming(false);
  };
  return (
    <span
      className="inline-confirm"
      role="group"
      aria-label={prompt}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <strong>{prompt}</strong>
      <Button ref={cancelRef}  type="button" onClick={cancel}>Cancel</Button>
      <Button
        variant="danger"
        type="button"
        disabled={disabled}
        onClick={() => {
          restoreFocus.current = true;
          setConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </span>
  );
}
