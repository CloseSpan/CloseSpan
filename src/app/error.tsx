"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><div className="brandmark">F</div><h1>Something went wrong</h1><p>Feelow AI could not load this view. No action was executed.</p><button type="button" className="btn primary" onClick={reset}>Try again</button></main>;
}
