"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  workspaceRouteDirection,
  type WorkspaceRouteDirection,
} from "@/lib/workspace-navigation";

export function WorkspaceRouteTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [routeState, setRouteState] = useState<{
    pathname: string;
    direction: WorkspaceRouteDirection;
  }>({ pathname, direction: "none" });

  if (routeState.pathname !== pathname) {
    setRouteState({
      pathname,
      direction: workspaceRouteDirection(routeState.pathname, pathname),
    });
  }

  const direction =
    routeState.pathname === pathname ? routeState.direction : "none";

  const offset =
    direction === "forward" ? 18 : direction === "backward" ? -18 : 0;

  return (
    <AnimatePresence initial={false} mode="wait" custom={offset}>
      <motion.div
        key={pathname}
        className="workspace-route-stage"
        data-route-direction={direction}
        custom={offset}
        initial={
          reduceMotion || direction === "none"
            ? { opacity: 1, y: 0 }
            : { opacity: 0.78, y: offset }
        }
        animate={{ opacity: 1, y: 0 }}
        exit={
          reduceMotion || direction === "none"
            ? { opacity: 1, y: 0 }
            : { opacity: 0.78, y: -offset }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
