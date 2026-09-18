import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "@/styles/globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  variable: "--font-dm-serif",
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gracemark Academy — Result Hub & School Portal",
  description: "Official School Portal and Result Hub for Gracemark Academy",
  icons: {
    icon: "/assets/icons/favicon.jpg",
    apple: "/assets/icons/logo.jpg",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`}>
      <body className="min-h-[100dvh] antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
