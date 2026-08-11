"use client";

import { useEffect } from "react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace route failed to render", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <section
      className="card workspace-route-error"
      role="alert"
      aria-live="assertive"
    >
      <div className="card-body detail-stack">
        <h1>This page could not load</h1>
        <p className="subtle">
          Your workspace is still available. Try loading this section again.
        </p>
        <button className="btn primary" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </section>
  );
}
