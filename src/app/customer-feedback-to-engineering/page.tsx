import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  customerFeedbackToEngineeringPage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(customerFeedbackToEngineeringPage);

export default function CustomerFeedbackToEngineeringPage() {
  return <PublicMarketingPage page={customerFeedbackToEngineeringPage} />;
}
