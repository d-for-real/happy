import { describe, expect, it, vi } from 'vitest';

const { mockPsList } = vi.hoisted(() => ({
    mockPsList: vi.fn()
}));

vi.mock('ps-list', () => ({
    default: mockPsList
}));

import { findAllHappyProcesses } from './doctor';

describe('findAllHappyProcesses', () => {
    it('detects daemon process even when ps-list reports name as MainThread', async () => {
        mockPsList.mockResolvedValueOnce([
            {
                pid: 15416,
                name: 'MainThread',
                cmd: 'node --no-warnings --no-deprecation /home/ubuntu/Documents/development/happy/packages/happy-cli/dist/index.mjs daemon start-sync'
            },
            {
                pid: 1,
                name: 'systemd',
                cmd: '/sbin/init'
            }
        ]);

        const processes = await findAllHappyProcesses();
        expect(processes).toEqual([
            expect.objectContaining({
                pid: 15416,
                type: 'daemon'
            })
        ]);
    });
});
