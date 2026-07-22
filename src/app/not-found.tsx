import Link from "next/link";
import { ClosespanLogo } from "@/components/closespan-logo";

export default function NotFound() {
  return <main className="error-page"><ClosespanLogo size="lg"/><h1>Page not found</h1><p>The requested Closespan record does not exist or is outside your workspace.</p><Link className="btn primary" href="/overview">Return to overview</Link></main>;
}
