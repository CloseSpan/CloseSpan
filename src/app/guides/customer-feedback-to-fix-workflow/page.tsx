import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  feedbackToFixGuidePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(feedbackToFixGuidePage);

export default function FeedbackToFixGuidePage() {
  return <PublicMarketingPage page={feedbackToFixGuidePage} />;
}
