import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDatasourceUrl, createPrismaClient, getBasePrismaClient } from '@/lib/db';

describe('Audit P0: Prisma Connection Pooling & Client Hygiene (DEF-001 & DEF-010)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('R1.1: getDatasourceUrl appends connection_limit and pool_timeout for web server', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/smmplan_test';
    delete process.env.APP_ROLE;
    delete process.env.IS_WORKER;

    const url = getDatasourceUrl();
    expect(url).toBeDefined();
    expect(url).toContain('connection_limit=');
    expect(url).toContain('pool_timeout=');
  });

  it('R1.2: getDatasourceUrl applies smaller connection_limit for workers', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/smmplan_test';
    process.env.APP_ROLE = 'worker';

    const url = getDatasourceUrl();
    expect(url).toBeDefined();
    expect(url).toMatch(/connection_limit=(3|4|5)/);
  });

  it('R1.3: getDatasourceUrl respects explicit DATABASE_POOL_SIZE', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/smmplan_test';
    process.env.DATABASE_POOL_SIZE = '12';

    const url = getDatasourceUrl();
    expect(url).toBeDefined();
    expect(url).toContain('connection_limit=12');
  });

  it('R1.4: DEF-010 prevention - rawPrisma is isolated from extended db instance', () => {
    const raw = getBasePrismaClient();
    expect(raw).toBeDefined();
    // Raw prisma should NOT have double extension layers
    expect((raw as any).$isExtendedClient).toBeFalsy();
  });
});
