import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "@/styles/globals.css";
import "@/styles/portal-layout.css";
import "@/styles/result-dashboard.css";
import "@/styles/score-entry.css";
import "@/styles/powered-by.css";
import "@/styles/pwa-install.css";
import "@/styles/skeleton.css";
import SplashRemover from "@/components/shared/SplashRemover";

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

const GOOGLE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ||
  "upS5-BO30CEEKPDgd6Czl7WVTDaIyY0olzocjQCCg1Y";

export const metadata: Metadata = {
  metadataBase: new URL("https://gracemarkportal.com.ng"),
  title: {
    default: "GraceMark Academic Portal",
    template: "%s | GraceMark Academic Portal",
  },
  description:
    "GraceMark Academic Portal — Student Results Checker, Attendance, Online Admissions & Academic Records for Gracemark Academy.",
  applicationName: "GraceMark Academic Portal",
  authors: [{ name: "GraceMark Academy", url: "https://gracemarkportal.com.ng" }],
  creator: "GraceMark Academy",
  publisher: "GraceMark Academy",
  category: "Education",
  keywords: [
    "GraceMark Academy",
    "GraceMark Academic Portal",
    "Gracemark portal",
    "Gracemark student portal",
    "Gracemark Academy Nigeria",
    "student result checker",
    "online report card portal",
    "school portal Nigeria",
    "academic portal Nigeria",
    "student attendance system",
    "Gracemark admission form",
    "school management portal",
    "secondary school portal Nigeria",
    "primary school portal Nigeria",
    "Gracemark online results",
    "Gracemark teachers gradebook",
  ],
  alternates: {
    canonical: "https://gracemarkportal.com.ng",
  },
  verification: {
    google: GOOGLE_VERIFICATION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/assets/icons/favicon.jpg",
    apple: "/assets/icons/logo.jpg",
  },
  openGraph: {
    title: "GraceMark Academic Portal",
    description:
      "Official Academic Portal for Gracemark Academy. Check student terminal results, monitor attendance, and access academic records.",
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
    description:
      "Official Academic Portal for Gracemark Academy. Results, attendance & student records.",
    images: ["https://gracemarkportal.com.ng/assets/icons/logo.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

// Schema.org Structured Data (JSON-LD) for rich search engine indexing
const jsonLdData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "EducationalOrganization",
      "@id": "https://gracemarkportal.com.ng/#organization",
      "name": "GraceMark Academy",
      "url": "https://gracemarkportal.com.ng",
      "logo": "https://gracemarkportal.com.ng/assets/icons/logo.jpg",
      "description":
        "GraceMark Academic Portal — Results, Attendance & Student Records for Gracemark Academy.",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "Customer Support",
        "email": "noreply@gracemarkportal.com.ng"
      }
    },
    {
      "@type": "WebSite",
      "@id": "https://gracemarkportal.com.ng/#website",
      "url": "https://gracemarkportal.com.ng",
      "name": "GraceMark Academic Portal",
      "description":
        "Official Academic Portal for Gracemark Academy. Check student terminal results, monitor attendance, and access academic records.",
      "publisher": {
        "@id": "https://gracemarkportal.com.ng/#organization"
      },
      "inLanguage": "en-NG"
    }
  ]
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdData) }}
        />
      </head>
      <body className="antialiased">
        <div id="gm-splash" aria-hidden="true">
          <div className="gm-splash__mark">
            <span className="gm-splash__ring" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/icons/logo.jpg" alt="" />
          </div>
          <span className="gm-splash__name">GraceMark Academy</span>
          <span className="gm-splash__bar" />
        </div>
        <SplashRemover />
        {children}
      </body>
    </html>
  );
}
