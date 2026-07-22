"use client";

import { ClosespanLogo } from "@/components/closespan-logo";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><ClosespanLogo size="lg"/><h1>Something went wrong</h1><p>Closespan could not load this view. No action was executed.</p><button type="button" className="btn primary" onClick={reset}>Try again</button></main>;
}
