"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AgentRunAutoRefresh({ active, quiet = false }: { active: boolean; quiet?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(interval);
  }, [active, router]);
  return active ? <span className={quiet ? "sr-only" : "subtle"} role="status">Live status refreshes every 3 seconds.</span> : null;
}
