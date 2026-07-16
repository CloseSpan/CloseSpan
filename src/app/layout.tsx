import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FeedbackFlow AI", template: "%s · FeedbackFlow AI" },
  description: "Evidence-driven customer feedback intelligence and resolution operations.",
  applicationName: "FeedbackFlow AI",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#111a2d", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
