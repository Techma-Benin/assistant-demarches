import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@techma/ui'],
  // pnpm dev serves the app on 127.0.0.1 (PUBLIC_URL, Keycloak redirect URIs); without this Next blocks its dev scripts there.
  allowedDevOrigins: ['127.0.0.1'],
  // Hero photos are served at quality 85 (Next only allows listed qualities).
  images: {
    qualities: [75, 85],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1680, 1920, 2048, 2400, 2880, 3840],
  },
  // Back-office pages must never be framed (clickjacking); /embed stays frameable.
  async headers() {
    const headers = [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
    ];
    return [
      { source: '/admin/:path*', headers },
      { source: '/operateur/:path*', headers },
    ];
  },
};

export default nextConfig;
