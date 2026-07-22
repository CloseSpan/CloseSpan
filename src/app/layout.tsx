import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Closespan", template: "%s · Closespan" },
  description: "Evidence-driven customer feedback intelligence and resolution operations.",
  applicationName: "Closespan",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#111a2d", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
