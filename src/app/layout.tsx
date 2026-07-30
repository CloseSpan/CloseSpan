import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import { COLOR_THEME_STORAGE_KEY } from "@/lib/color-theme";
import { ThemeController } from "@/components/theme-controller";
import "./globals.css";
import "./neumorphic-theme.css";

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
      { url: "/favicon.ico", type: "image/x-icon", sizes: "48x48" },
      { url: "/favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/favicon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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

const themeBootstrap = `(() => {
  try {
    const cookieTheme = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(${JSON.stringify(`${COLOR_THEME_STORAGE_KEY}=`)}))
      ?.split("=")[1];
    let storedTheme = null;
    try {
      storedTheme = localStorage.getItem(${JSON.stringify(COLOR_THEME_STORAGE_KEY)});
    } catch {}
    const saved = storedTheme || cookieTheme;
    const theme = saved === "light" || saved === "dark"
      ? saved
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", theme === "dark" ? "#151b27" : "#e9eef7"));
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta id="closespan-theme-color" name="theme-color" content="#e9eef7" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeController />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
