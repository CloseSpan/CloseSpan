import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  resourcesPage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(resourcesPage);

export default function ResourcesPage() {
  return <PublicMarketingPage page={resourcesPage} />;
}
