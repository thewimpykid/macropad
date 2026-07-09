import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import TerrainBackdrop from "@/components/fx/TerrainBackdrop";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetMono = JetBrains_Mono({
  variable: "--font-jet",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Macropad — the regime desk",
  description:
    "Live macro desk: US macro, yield rates, COT positioning, transmission, volatility - regime signals and per-asset net bias.",
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
    <html lang="en" className={`${geistSans.variable} ${jetMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--text)]">
        <TerrainBackdrop />
        <div className="relative flex min-h-full flex-1 flex-col">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
