import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Inter, Space_Grotesk, IBM_Plex_Mono, Fira_Code } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import TerrainBackdrop from "@/components/fx/TerrainBackdrop";
import ThemeSync from "@/components/fx/ThemeSync";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetMono = JetBrains_Mono({
  variable: "--font-jet",
  subsets: ["latin"],
});

// Alternate font presets for the settings panel. next/font self-hosts and
// only ships @font-face CSS - files download solely when a preset is active.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trifekta · The Regime Desk",
  description:
    "Live macro desk: US macro, yield rates, positioning, transmission, geopolitics, and volatility. Every read scored, one composite bias, one screen.",
};

export const viewport: Viewport = {
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetMono.variable} ${inter.variable} ${spaceGrotesk.variable} ${plexMono.variable} ${firaCode.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <ThemeSync />
        <TerrainBackdrop />
        <div className="relative flex min-h-full flex-1 flex-col">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
