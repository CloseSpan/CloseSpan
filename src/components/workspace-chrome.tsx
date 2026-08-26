"use client";

import { Save, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type WorkspacePrimaryAction = {
  id: string;
  label: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onTrigger: () => void;
};

type WorkspaceChromeContextValue = {
  primaryAction: WorkspacePrimaryAction | null;
  setPrimaryAction: (action: WorkspacePrimaryAction) => void;
  clearPrimaryAction: (id: string) => void;
};

const WorkspaceChromeContext = createContext<WorkspaceChromeContextValue | null>(
  null,
);

export function WorkspaceChromeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [primaryAction, updatePrimaryAction] =
    useState<WorkspacePrimaryAction | null>(null);
  const setPrimaryAction = useCallback((action: WorkspacePrimaryAction) => {
    updatePrimaryAction(action);
  }, []);
  const clearPrimaryAction = useCallback((id: string) => {
    updatePrimaryAction((current) => (current?.id === id ? null : current));
  }, []);
  const value = useMemo(
    () => ({ primaryAction, setPrimaryAction, clearPrimaryAction }),
    [clearPrimaryAction, primaryAction, setPrimaryAction],
  );

  return (
    <WorkspaceChromeContext.Provider value={value}>
      {children}
    </WorkspaceChromeContext.Provider>
  );
}

export function useWorkspaceChrome(): WorkspaceChromeContextValue {
  const value = useContext(WorkspaceChromeContext);
  if (!value) {
    throw new Error("useWorkspaceChrome must be used within WorkspaceChromeProvider.");
  }
  return value;
}

export function WorkspacePrimaryActionControl() {
  const { primaryAction } = useWorkspaceChrome();
  const pathname = usePathname();
  const settingsRoute =
    pathname === "/settings" || pathname.startsWith("/settings/");

  if (!settingsRoute) {
    return (
      <Link className="btn search-action" href="/feedback" prefetch={false}>
        <Search size={15} />
        <span>Search feedback</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="btn primary workspace-primary-action"
      disabled={
        !primaryAction || primaryAction.disabled || primaryAction.pending
      }
      title={primaryAction?.disabledReason}
      aria-label={
        primaryAction?.disabledReason
          ? `${primaryAction.label}. ${primaryAction.disabledReason}`
          : (primaryAction?.label ?? "Save policy")
      }
      onClick={primaryAction?.onTrigger}
    >
      <Save aria-hidden="true" size={15} />
      <span>
        {primaryAction?.pending
          ? (primaryAction.pendingLabel ?? primaryAction.label)
          : (primaryAction?.label ?? "Save policy")}
      </span>
    </button>
  );
}
