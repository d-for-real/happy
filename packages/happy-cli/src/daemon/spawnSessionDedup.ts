import { resolve as resolvePath } from 'path';

import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

function normalizeEnvironmentVariables(
  env?: SpawnSessionOptions['environmentVariables']
): Record<string, string> {
  if (!env) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, value as string])
  );
}

export function createSpawnSessionDedupKey(options: SpawnSessionOptions): string {
  return JSON.stringify({
    directory: resolvePath(options.directory),
    sessionId: options.sessionId ?? '',
    machineId: options.machineId ?? '',
    approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? true,
    agent: options.agent ?? 'claude',
    token: options.token ?? '',
    environmentVariables: normalizeEnvironmentVariables(options.environmentVariables)
  });
}

export function getOrCreateInFlightSpawnSession({
  inFlightSpawnRequests,
  options,
  createSpawnPromise
}: {
  inFlightSpawnRequests: Map<string, Promise<SpawnSessionResult>>;
  options: SpawnSessionOptions;
  createSpawnPromise: () => Promise<SpawnSessionResult>;
}): { promise: Promise<SpawnSessionResult>; deduped: boolean } {
  const key = createSpawnSessionDedupKey(options);
  const existing = inFlightSpawnRequests.get(key);

  if (existing) {
    return { promise: existing, deduped: true };
  }

  const promise = (async () => {
    try {
      return await createSpawnPromise();
    } finally {
      inFlightSpawnRequests.delete(key);
    }
  })();

  inFlightSpawnRequests.set(key, promise);
  return { promise, deduped: false };
}
