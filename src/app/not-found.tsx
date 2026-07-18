import Link from "next/link";

export default function NotFound() {
  return <main className="error-page"><div className="brandmark">F</div><h1>Page not found</h1><p>The requested Feelow AI record does not exist or is outside your workspace.</p><Link className="btn primary" href="/overview">Return to overview</Link></main>;
}
