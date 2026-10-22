import { useReducedMotion } from "framer-motion";
import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => undefined;

/**
 * The reduced-motion preference, reported only after hydration. The server
 * cannot know it, so returning it during the hydrating render would make the
 * browser's markup differ from the server's. Motion is reduced from the next
 * render on, before any animation is perceptible.
 */
export function useHydrationSafeReducedMotion(): boolean {
  const reduce = useReducedMotion();
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  return hydrated && Boolean(reduce);
}
