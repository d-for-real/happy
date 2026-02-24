import { describe, expect, it, vi } from 'vitest';

import type { SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

import { createSpawnSessionDedupKey, getOrCreateInFlightSpawnSession } from './spawnSessionDedup';

describe('createSpawnSessionDedupKey', () => {
  it('normalizes path and environment variable ordering', () => {
    const keyA = createSpawnSessionDedupKey({
      directory: '/tmp/../tmp',
      agent: 'codex',
      environmentVariables: {
        ANTHROPIC_MODEL: 'claude-3-5-sonnet',
        ANTHROPIC_BASE_URL: 'https://api.example.com'
      }
    });

    const keyB = createSpawnSessionDedupKey({
      directory: '/tmp',
      agent: 'codex',
      environmentVariables: {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_MODEL: 'claude-3-5-sonnet'
      }
    });

    expect(keyA).toBe(keyB);
  });

  it('treats different session ids as different keys', () => {
    const keyA = createSpawnSessionDedupKey({
      directory: '/tmp',
      sessionId: 'session-a'
    });

    const keyB = createSpawnSessionDedupKey({
      directory: '/tmp',
      sessionId: 'session-b'
    });

    expect(keyA).not.toBe(keyB);
  });
});

describe('getOrCreateInFlightSpawnSession', () => {
  it('reuses the same in-flight promise for identical requests', async () => {
    const inFlightSpawnRequests = new Map<string, Promise<SpawnSessionResult>>();
    let resolveSpawn!: (result: SpawnSessionResult) => void;
    const spawnPromise = new Promise<SpawnSessionResult>((resolve) => {
      resolveSpawn = resolve;
    });
    const createSpawnPromise = vi.fn(() => spawnPromise);
    const options = { directory: '/tmp', agent: 'codex' as const };

    const first = getOrCreateInFlightSpawnSession({
      inFlightSpawnRequests,
      options,
      createSpawnPromise
    });
    const second = getOrCreateInFlightSpawnSession({
      inFlightSpawnRequests,
      options,
      createSpawnPromise
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(first.promise).toBe(second.promise);
    expect(createSpawnPromise).toHaveBeenCalledTimes(1);

    resolveSpawn({ type: 'success', sessionId: 'session-1' });
    await expect(first.promise).resolves.toEqual({ type: 'success', sessionId: 'session-1' });
    expect(inFlightSpawnRequests.size).toBe(0);
  });

  it('cleans up in-flight key after failure so retries are possible', async () => {
    const inFlightSpawnRequests = new Map<string, Promise<SpawnSessionResult>>();
    const options = { directory: '/tmp', agent: 'codex' as const };
    const createSpawnPromise = vi.fn(async () => {
      throw new Error('boom');
    });

    const first = getOrCreateInFlightSpawnSession({
      inFlightSpawnRequests,
      options,
      createSpawnPromise
    });
    await expect(first.promise).rejects.toThrow('boom');
    expect(inFlightSpawnRequests.size).toBe(0);

    const second = getOrCreateInFlightSpawnSession({
      inFlightSpawnRequests,
      options,
      createSpawnPromise
    });
    expect(second.deduped).toBe(false);
    expect(createSpawnPromise).toHaveBeenCalledTimes(2);
    await expect(second.promise).rejects.toThrow('boom');
  });
});
