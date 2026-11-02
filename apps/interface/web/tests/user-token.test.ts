// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserToken } from '@/server/user-token';

afterEach(() => vi.unstubAllEnvs());

describe('getUserToken', () => {
  it('returns the mock token in development on loopback', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_USER_TOKEN', 'mock-user');
    for (const url of ['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010']) {
      vi.stubEnv('BACKEND_URL', url);
      expect(getUserToken()).toBe('mock-user');
    }
  });

  it('throws in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MOCK_USER_TOKEN', 'mock-user');
    expect(() => getUserToken()).toThrow('Session OIDC non branchée');
  });

  it('throws when the mock token is missing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_USER_TOKEN', '');
    expect(() => getUserToken()).toThrow();
  });

  it('throws for a mock token with a non-loopback backend', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_USER_TOKEN', 'mock-user');
    vi.stubEnv('BACKEND_URL', 'https://backend.example.org');
    expect(() => getUserToken()).toThrow();
  });
});
