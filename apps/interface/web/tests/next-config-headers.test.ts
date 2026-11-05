import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('next.config headers', () => {
  it('forbids framing of /admin and /operateur', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    for (const source of ['/admin/:path*', '/operateur/:path*']) {
      const rule = rules.find((r) => r.source === source);
      expect(rule?.headers).toEqual(
        expect.arrayContaining([
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ]),
      );
    }
  });

  it('adds no rule on /embed', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.some((r) => r.source.startsWith('/embed'))).toBe(false);
  });
});
