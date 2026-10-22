import { ButtonLink } from "@/components/ui";
import { CloseSpan3DLogo } from "@/components/closespan-3d-logo";

export default function NotFound() {
  return <main className="error-page"><CloseSpan3DLogo decorative={false} priority size="lg"/><h1>Page not found</h1><p>The requested CloseSpan record does not exist or is outside your workspace.</p><ButtonLink variant="primary" href="/problems">Return to issues</ButtonLink></main>;
}
