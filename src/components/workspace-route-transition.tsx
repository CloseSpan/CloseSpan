"use client";

import { motion, useReducedMotion } from "framer-motion";
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
  let direction = routeState.direction;

  if (routeState.pathname !== pathname) {
    direction = workspaceRouteDirection(routeState.pathname, pathname);
    setRouteState({ pathname, direction });
  }

  const offset =
    direction === "forward" ? 18 : direction === "backward" ? -18 : 0;

  return (
    <motion.div
      key={pathname}
      className="workspace-route-stage"
      data-route-direction={direction}
      initial={
        reduceMotion || direction === "none"
          ? false
          : { opacity: 0.78, y: offset }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }
      }
    >
      {children}
    </motion.div>
  );
}
