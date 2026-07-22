import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  closeCustomerFeedbackLoopPage,
  createPublicSeoMetadata,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(closeCustomerFeedbackLoopPage);

export default function CloseCustomerFeedbackLoopPage() {
  return <PublicMarketingPage page={closeCustomerFeedbackLoopPage} />;
}
