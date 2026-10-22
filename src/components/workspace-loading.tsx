/**
 * Loading placeholders shaped like the page that is coming, so content does
 * not jump when it arrives. "detail" matches issue, approval and run pages.
 */
export function WorkspaceLoading({ variant = "list" }: { variant?: "list" | "detail" }) {
  if (variant === "detail") {
    return (
      <div className="loading-page loading-page-detail" role="status" aria-label="Loading CloseSpan">
        <div className="skeleton skeleton-eyebrow" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton-detail">
          <div className="skeleton-detail-main">
            <div className="skeleton skeleton-panel" />
            <div className="skeleton skeleton-panel" />
          </div>
          <div className="skeleton skeleton-panel" />
        </div>
      </div>
    );
  }
  return (
    <div className="loading-page" role="status" aria-label="Loading CloseSpan">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
