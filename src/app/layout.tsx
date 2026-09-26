import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import { COLOR_THEME_BOOTSTRAP_SCRIPT, DEFAULT_COLOR_THEME } from "@/lib/color-theme";
import { ThemeController } from "@/components/theme-controller";
import { GooeyInteractions } from "@/components/gooey-interactions";
import "./globals.css";
import "./neumorphic-theme.css";
import "./product-theme.css";

// Reuse Next's bundled Geist font; no third-party font request at build or runtime.
const geist = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "business software",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/closespan-title-icon-v3.ico",
        type: "image/x-icon",
        sizes: "48x48",
      },
      {
        url: "/closespan-title-icon-48-v3.png",
        type: "image/png",
        sizes: "48x48",
      },
      {
        url: "/closespan-title-icon-192-v3.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/closespan-title-icon-512-v3.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    shortcut: [
      { url: "/closespan-title-icon-v3.ico", type: "image/x-icon" },
    ],
    apple: [
      {
        url: "/closespan-title-icon-180-v3.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.BING_SITE_VERIFICATION
      ? {
          other: {
            "msvalidate.01": process.env.BING_SITE_VERIFICATION,
          },
        }
      : {}),
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable} data-theme={DEFAULT_COLOR_THEME} suppressHydrationWarning>
      <head>
        <meta id="closespan-theme-color" name="theme-color" content="#ffffff" />
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <ThemeController />
        <GooeyInteractions />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
