"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section className="card workspace-route-error" role="alert">
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
