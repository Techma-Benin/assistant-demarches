import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Production builds must not replace the development server's .next output.
  distDir: process.env.SHOWCASE_PRODUCTION === '1' ? '.next-showcase' : '.next',
  reactStrictMode: true,
  transpilePackages: ['@techma/ui'],
  async rewrites() {
    return [
      ...(process.env.SHOWCASE_PRODUCTION === '1' ? [] : [
        { source: '/v1/stream', destination: 'http://127.0.0.1:4010/v1/stream' },
      ]),
      { source: '/keycloak/realms/techma/:path*', destination: 'http://127.0.0.1:8081/realms/techma/:path*' },
      { source: '/keycloak/resources/:path*', destination: 'http://127.0.0.1:8081/resources/:path*' },
    ];
  },
  // pnpm dev serves the app on 127.0.0.1 (PUBLIC_URL, Keycloak redirect URIs); without this Next blocks its dev scripts there.
  allowedDevOrigins: ['127.0.0.1', ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : [])],
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
