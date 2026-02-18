import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.build.json",
  },
  async headers() {
    const noIndexHeaders = [
      {
        key: "X-Robots-Tag",
        value: "noindex, nofollow",
      },
    ];

    return [
      {
        source: "/:path*",
        headers: noIndexHeaders,
      },
    ];
  },
};

export default nextConfig;
