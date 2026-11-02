import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Gilroy (Fontspring EULA, see fonts/gilroy/License.txt): WOFF2 made from the TTFs in personal-portfolio-2025.
const gilroy = localFont({
  src: [
    { path: "./fonts/gilroy/Gilroy-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/gilroy/Gilroy-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/gilroy/Gilroy-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/gilroy/Gilroy-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-gilroy",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Arcanus AI",
  description:
    "A fully local AI in your browser: ARC 1 decides, SmolVLM writes, Paradee speaks, and a 3D sphere reacts to its voice.",
  applicationName: "Arcanus",
  appleWebApp: { capable: true, title: "Arcanus", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables go on <html>: globals.css reads them in :root (--font-ui), which is <html>.
    <html lang="en" className={`${gilroy.variable} ${plexMono.variable}`} suppressHydrationWarning={true}>
      <body suppressHydrationWarning={true}>
        {children}
      </body>
    </html>
  );
}
