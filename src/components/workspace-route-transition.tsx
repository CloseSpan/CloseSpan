"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { workspaceSection } from "@/lib/workspace-navigation";

export function WorkspaceRouteTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const enterOffset = reduceMotion ? 0 : 8;

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {workspaceSection(pathname)} loaded
      </span>
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={pathname}
          className="workspace-route-stage"
          data-route-direction="none"
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0.86, y: enterOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0.9, y: -4 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }
          }
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
