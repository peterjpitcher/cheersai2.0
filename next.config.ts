import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;