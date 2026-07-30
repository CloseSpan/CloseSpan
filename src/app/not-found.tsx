import Link from "next/link";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";

export default function NotFound() {
  return <main className="error-page"><CloseSpan3DLogo decorative={false} priority size="lg"/><h1>Page not found</h1><p>The requested CloseSpan record does not exist or is outside your workspace.</p><Link className="btn primary" href="/overview">Return to overview</Link></main>;
}
