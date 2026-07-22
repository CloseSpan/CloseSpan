import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  customerFeedbackOperationsPage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(customerFeedbackOperationsPage);

export default function CustomerFeedbackOperationsPage() {
  return <PublicMarketingPage page={customerFeedbackOperationsPage} />;
}
