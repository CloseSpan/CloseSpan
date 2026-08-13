"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { workspaceSection } from "@/lib/workspace-navigation";

function resetWorkspaceScrollPosition(): void {
  // The workspace shell persists between routes, so the browser can retain the
  // previous page's document and sidebar scroll positions. Direct scrollTop
  // assignments are intentional here: unlike scrollTo({ behavior: "auto" }),
  // they are not converted into a delayed animation by the global smooth-scroll
  // rule and therefore cannot leave the next screen clipped beneath the topbar.
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  document
    .querySelectorAll<HTMLElement>(".app-shell .main, .app-shell .content")
    .forEach((region) => {
      region.scrollTop = 0;
      region.scrollLeft = 0;
    });

  const activeNavigationItem = document.querySelector<HTMLElement>(
    '.app-shell .sidebar .nav a[aria-current="page"]',
  );
  const navigation = activeNavigationItem?.closest<HTMLElement>(".nav");
  if (!activeNavigationItem || !navigation) return;

  const navigationBounds = navigation.getBoundingClientRect();
  const itemBounds = activeNavigationItem.getBoundingClientRect();
  const inset = 8;

  if (itemBounds.top < navigationBounds.top + inset) {
    navigation.scrollTop -=
      navigationBounds.top + inset - itemBounds.top;
  } else if (itemBounds.bottom > navigationBounds.bottom - inset) {
    navigation.scrollTop +=
      itemBounds.bottom - (navigationBounds.bottom - inset);
  }
}

export function WorkspaceRouteTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    resetWorkspaceScrollPosition();
  }, [pathname]);

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
