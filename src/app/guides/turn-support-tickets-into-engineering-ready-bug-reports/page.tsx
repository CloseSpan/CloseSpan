import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  engineeringBugReportGuidePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(engineeringBugReportGuidePage);

export default function EngineeringBugReportGuidePage() {
  return <PublicMarketingPage page={engineeringBugReportGuidePage} />;
}
