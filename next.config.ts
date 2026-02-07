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
        source: "/",
        headers: noIndexHeaders,
      },
      {
        source: "/login",
        headers: noIndexHeaders,
      },
      {
        source: "/planner/:path*",
        headers: noIndexHeaders,
      },
      {
        source: "/create/:path*",
        headers: noIndexHeaders,
      },
      {
        source: "/library/:path*",
        headers: noIndexHeaders,
      },
      {
        source: "/connections/:path*",
        headers: noIndexHeaders,
      },
      {
        source: "/settings/:path*",
        headers: noIndexHeaders,
      },
      {
        source: "/api/:path*",
        headers: noIndexHeaders,
      },
    ];
  },
};

export default nextConfig;
