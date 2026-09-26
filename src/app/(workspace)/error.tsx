"use client";

import { useEffect } from "react";
import Link from "next/link";

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
          Retry this page. If it still fails, return to the overview.
        </p>
        <button className="btn primary" type="button" onClick={reset}>
          Retry page
        </button>
        <Link className="text-link" href="/overview">Back to overview</Link>
      </div>
    </section>
  );
}
