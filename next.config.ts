import type { NextConfig } from "next";
import { legacyHostRedirects } from "@/lib/routing/legacy-host-redirects";
import { securityHeaders } from "@/lib/security/headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  typescript: {
    tsconfigPath: "./tsconfig.build.json",
  },
  async headers() {
    return securityHeaders;
  },
  async redirects() {
    return legacyHostRedirects;
  },
};

export default nextConfig;
