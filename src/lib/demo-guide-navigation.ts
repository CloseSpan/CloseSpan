interface DemoGuideRouteStep {
  path: string;
}

export function resolveDemoGuideStepIndex(
  steps: DemoGuideRouteStep[],
  pathname: string,
  storedIndex: number,
): number {
  const validStoredIndex = Number.isInteger(storedIndex)
    && storedIndex >= 0
    && storedIndex < steps.length
      ? storedIndex
      : null;

  // A walkthrough can intentionally revisit the same page. Preserve the
  // persisted occurrence instead of always jumping back to the first step
  // with that pathname.
  if (
    validStoredIndex !== null
    && steps[validStoredIndex]?.path === pathname
  ) {
    return validStoredIndex;
  }

  const pathIndex = steps.findIndex((candidate) => candidate.path === pathname);
  if (pathIndex >= 0) return pathIndex;
  return validStoredIndex ?? 0;
}
