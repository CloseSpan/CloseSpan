import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  productFixVerificationGuidePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(productFixVerificationGuidePage);

export default function ProductFixVerificationGuidePage() {
  return <PublicMarketingPage page={productFixVerificationGuidePage} />;
}
