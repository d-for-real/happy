import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveHappyMcpBridgeLaunch } from '../happyMcpBridgeLaunch';

function createExistsSync(paths: string[]): (path: string) => boolean {
    const entries = new Set(paths);
    return (path: string) => entries.has(path);
}

describe('resolveHappyMcpBridgeLaunch', () => {
    const root = '/tmp/happy-cli';

    it('prefers dist bridge via process.execPath when available', () => {
        const dist = join(root, 'dist', 'codex', 'happyMcpStdioBridge.mjs');

        const resolved = resolveHappyMcpBridgeLaunch({
            projectRoot: root,
            existsSync: createExistsSync([dist]),
            execPath: '/usr/local/bin/node',
        });

        expect(resolved).toEqual({
            command: '/usr/local/bin/node',
            args: ['--no-warnings', '--no-deprecation', dist],
            mode: 'dist',
        });
    });

    it('falls back to tsx source bridge in dev mode when dist is missing', () => {
        const tsx = join(root, 'node_modules', '.bin', 'tsx');
        const src = join(root, 'src', 'codex', 'happyMcpStdioBridge.ts');

        const resolved = resolveHappyMcpBridgeLaunch({
            projectRoot: root,
            existsSync: createExistsSync([tsx, src]),
            platform: 'linux',
        });

        expect(resolved).toEqual({
            command: tsx,
            args: [src],
            mode: 'tsx',
        });
    });

    it('uses tsx.cmd on windows for source bridge fallback', () => {
        const tsx = join(root, 'node_modules', '.bin', 'tsx.cmd');
        const src = join(root, 'src', 'codex', 'happyMcpStdioBridge.ts');

        const resolved = resolveHappyMcpBridgeLaunch({
            projectRoot: root,
            existsSync: createExistsSync([tsx, src]),
            platform: 'win32',
        });

        expect(resolved).toEqual({
            command: tsx,
            args: [src],
            mode: 'tsx',
        });
    });

    it('falls back to bin script when no direct bridge entrypoint is available', () => {
        const resolved = resolveHappyMcpBridgeLaunch({
            projectRoot: root,
            existsSync: createExistsSync([]),
        });

        expect(resolved).toEqual({
            command: join(root, 'bin', 'happy-mcp.mjs'),
            args: [],
            mode: 'bin',
        });
    });
});
