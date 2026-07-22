export function WorkspaceLoading() {
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
