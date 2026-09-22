import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/admission-form", "/form", "/forgot-password"],
        disallow: [
          "/admin",
          "/admin/*",
          "/teacher",
          "/teacher/*",
          "/student",
          "/student/*",
          "/parent",
          "/parent/*",
          "/api",
          "/api/*",
          "/otp-verify",
          "/change-password",
        ],
      },
    ],
    sitemap: "https://gracemarkportal.com.ng/sitemap.xml",
  };
}
