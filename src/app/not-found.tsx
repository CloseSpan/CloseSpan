import Link from "next/link";
import { CloseSpanLogo } from "@/components/closespan-logo";

export default function NotFound() {
  return <main className="error-page"><CloseSpanLogo size="lg"/><h1>Page not found</h1><p>The requested CloseSpan record does not exist or is outside your workspace.</p><Link className="btn primary" href="/overview">Return to overview</Link></main>;
}
