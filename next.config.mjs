/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  trailingSlash: false,
  transpilePackages: [
    "@supabase/supabase-js",
    "@supabase/auth-js",
    "@supabase/functions-js",
    "@supabase/postgrest-js",
    "@supabase/realtime-js",
    "@supabase/storage-js",
  ],
  // next/image is unused; disabling the optimizer removes the Next 14 image-API attack surface
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
