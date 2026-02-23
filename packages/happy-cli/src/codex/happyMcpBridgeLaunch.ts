import fs from 'node:fs';
import { join } from 'node:path';

export type HappyMcpBridgeLaunch = {
    command: string;
    args: string[];
    mode: 'dist' | 'tsx' | 'bin';
};

type ResolveHappyMcpBridgeLaunchOptions = {
    projectRoot: string;
    existsSync?: (path: string) => boolean;
    platform?: NodeJS.Platform;
    execPath?: string;
};

/**
 * Resolve how to launch the Happy MCP bridge in the current environment.
 * Prefer direct Node execution to avoid shebang/PATH issues in daemon/mobile contexts.
 */
export function resolveHappyMcpBridgeLaunch(
    options: ResolveHappyMcpBridgeLaunchOptions
): HappyMcpBridgeLaunch {
    const existsSync = options.existsSync ?? fs.existsSync;
    const platform = options.platform ?? process.platform;
    const execPath = options.execPath ?? process.execPath;

    const distEntrypoint = join(options.projectRoot, 'dist', 'codex', 'happyMcpStdioBridge.mjs');
    if (existsSync(distEntrypoint)) {
        return {
            command: execPath,
            args: ['--no-warnings', '--no-deprecation', distEntrypoint],
            mode: 'dist',
        };
    }

    const tsxBinary = join(options.projectRoot, 'node_modules', '.bin', platform === 'win32' ? 'tsx.cmd' : 'tsx');
    const sourceEntrypoint = join(options.projectRoot, 'src', 'codex', 'happyMcpStdioBridge.ts');
    if (existsSync(tsxBinary) && existsSync(sourceEntrypoint)) {
        return {
            command: tsxBinary,
            args: [sourceEntrypoint],
            mode: 'tsx',
        };
    }

    return {
        command: join(options.projectRoot, 'bin', 'happy-mcp.mjs'),
        args: [],
        mode: 'bin',
    };
}
