import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  revenuePrioritizationGuidePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(revenuePrioritizationGuidePage);

export default function RevenuePrioritizationGuidePage() {
  return <PublicMarketingPage page={revenuePrioritizationGuidePage} />;
}
