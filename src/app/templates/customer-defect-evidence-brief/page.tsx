import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  evidenceBriefTemplatePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(evidenceBriefTemplatePage);

export default function CustomerDefectEvidenceBriefPage() {
  return <PublicMarketingPage page={evidenceBriefTemplatePage} />;
}
