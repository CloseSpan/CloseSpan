import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  productOperationsUseCasePage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(productOperationsUseCasePage);

export default function ProductOperationsUseCasePage() {
  return <PublicMarketingPage page={productOperationsUseCasePage} />;
}
