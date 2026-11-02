// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdminToken } from '@/server/admin-token';

afterEach(() => vi.unstubAllEnvs());

describe('getAdminToken', () => {
  it('returns the mock token in development on loopback', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_ADMIN_TOKEN', 'mock-admin');
    for (const url of ['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010']) {
      vi.stubEnv('BACKEND_URL', url);
      expect(getAdminToken()).toBe('mock-admin');
    }
  });

  it('throws in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MOCK_ADMIN_TOKEN', 'mock-admin');
    expect(() => getAdminToken()).toThrow('Session OIDC administrateur non branchée');
  });

  it('throws when the mock token is missing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_ADMIN_TOKEN', '');
    expect(() => getAdminToken()).toThrow();
  });

  it('throws for a mock token with a non-loopback backend', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_ADMIN_TOKEN', 'mock-admin');
    vi.stubEnv('BACKEND_URL', 'https://backend.example.org');
    expect(() => getAdminToken()).toThrow();
  });
});
