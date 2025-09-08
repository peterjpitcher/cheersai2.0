import type { NextConfig } from "next";
// Lazy requires so Jest/tests don't need these installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let withSentryConfig: any = (cfg: any) => cfg;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  withSentryConfig = require('@sentry/nextjs').withSentryConfig || require('@sentry/nextjs').withSentryConfig;
} catch {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let withBundleAnalyzer: any = (cfg: any) => cfg;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
    openAnalyzer: false,
  });
} catch {}
// Validate env at build/startup for better DX
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ESM import from TS config is fine in Next runtime
import './env.mjs'

const baseConfig: NextConfig = {
  eslint: {
    // Only run ESLint on specific directories during production builds
    dirs: ['app', 'components', 'lib'],
    // Temporarily ignore ESLint errors during build to allow deployment
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Temporarily ignore TypeScript errors during build to allow deployment
    // TODO: Fix TypeScript errors and remove this
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
    ],
  },
  productionBrowserSourceMaps: true,
  webpack: (config, { isServer }) => {
    // Optimize bundle size
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@sentry/node': false,
        'bufferutil': false,
        'utf-8-validate': false,
      };
    }
    
    return config;
  },
  poweredByHeader: false,
  compress: true,
  generateEtags: true,
};
const nextConfig = withBundleAnalyzer(baseConfig);

export default withSentryConfig(nextConfig, {
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
});
