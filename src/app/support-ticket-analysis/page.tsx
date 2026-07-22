import { PublicMarketingPage } from "@/components/public-marketing-page";
import {
  createPublicSeoMetadata,
  supportTicketAnalysisPage,
} from "@/lib/public-seo-pages";

export const metadata = createPublicSeoMetadata(supportTicketAnalysisPage);

export default function SupportTicketAnalysisPage() {
  return <PublicMarketingPage page={supportTicketAnalysisPage} />;
}
