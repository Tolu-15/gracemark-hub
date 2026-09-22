import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "@/styles/globals.css";
import "@/styles/portal-layout.css";
import "@/styles/result-dashboard.css";
import "@/styles/score-entry.css";
import "@/styles/powered-by.css";
import "@/styles/pwa-install.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-dm-serif",
});

export const metadata: Metadata = {
  title: "GraceMark Academic Portal",
  description: "GraceMark Academic Portal — Results, Attendance & Student Records for Gracemark Academy",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/assets/icons/favicon.jpg",
    apple: "/assets/icons/logo.jpg",
  },
  openGraph: {
    title: "GraceMark Academic Portal",
    description: "GraceMark Academic Portal — Results, Attendance & Student Records for Gracemark Academy",
    url: "https://gracemarkportal.com.ng",
    siteName: "GraceMark Academic Portal",
    images: [
      {
        url: "https://gracemarkportal.com.ng/assets/icons/logo.jpg",
        width: 512,
        height: 512,
        alt: "GraceMark Academic Portal Logo",
      },
    ],
    locale: "en_NG",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "GraceMark Academic Portal",
    description: "GraceMark Academic Portal — Results, Attendance & Student Records for Gracemark Academy",
    images: ["https://gracemarkportal.com.ng/assets/icons/logo.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
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
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
