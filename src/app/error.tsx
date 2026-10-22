"use client";

import { Button } from "@/components/ui";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><CloseSpan3DLogo decorative={false} priority size="lg"/><h1>Something went wrong</h1><p>CloseSpan could not load this view. No action was executed.</p><Button type="button" variant="primary" onClick={reset}>Try again</Button></main>;
}
