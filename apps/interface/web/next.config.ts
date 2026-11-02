import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@techma/ui'],
  // Hero photos are served at quality 85 (Next only allows listed qualities).
  images: { qualities: [75, 85], formats: ['image/avif', 'image/webp'] },
};

export default nextConfig;
