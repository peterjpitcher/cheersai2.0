import type { NextConfig } from "next";
import { securityHeaders } from "@/lib/security/headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],
  typescript: {
    tsconfigPath: "./tsconfig.build.json",
  },
  async headers() {
    return securityHeaders;
  },
};

export default nextConfig;
