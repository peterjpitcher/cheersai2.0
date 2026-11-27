import type { NextConfig } from "next";
import { legacyHostRedirects } from "@/lib/routing/legacy-host-redirects";
import { securityHeaders } from "@/lib/security/headers";

const nextConfig: NextConfig = {
  // satori 0.33+ loads harfbuzzjs, which reads hb.wasm from its own folder at
  // runtime (__dirname). Bundled by webpack, __dirname points at .next chunks
  // and the file is missing ("ENOENT ... chunks/hb.wasm"), so every tournament
  // overlay failed after #248. Keep both external and ship the wasm.
  serverExternalPackages: ['sharp', 'satori', 'harfbuzzjs'],
  outputFileTracingIncludes: {
    '/**/*': ['./node_modules/harfbuzzjs/hb.wasm'],
  },
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
