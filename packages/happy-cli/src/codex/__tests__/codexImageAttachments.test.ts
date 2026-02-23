import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendCodexImageAttachmentFiles, getCodexAttachmentSessionDir, materializeCodexImageAttachments } from '../codexImageAttachments';

const createdDirs: string[] = [];

afterEach(() => {
    for (const dir of createdDirs.splice(0, createdDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function createWorkspaceRoot(): string {
    const dir = mkdtempSync(join(os.tmpdir(), 'codex-image-attachments-'));
    createdDirs.push(dir);
    return dir;
}

describe('codexImageAttachments', () => {
    it('materializes base64 image attachments into workspace files', () => {
        const workspaceRoot = createWorkspaceRoot();
        const attachments = [{
            id: 'abc-123',
            mimeType: 'image/png',
            data: Buffer.from('hello-image').toString('base64'),
            name: 'Sketch 01.png'
        }];

        const files = materializeCodexImageAttachments({
            attachments,
            workspaceRoot,
            sessionTag: 'session-x'
        });

        expect(files).toHaveLength(1);
        expect(files[0].relativePath.startsWith('.happy/codex-attachments/session-x/')).toBe(true);
        expect(files[0].absolutePath.endsWith('.png')).toBe(true);
        expect(fs.existsSync(files[0].absolutePath)).toBe(true);
        expect(fs.readFileSync(files[0].absolutePath, 'utf8')).toBe('hello-image');
    });

    it('builds a prompt block with attachment file paths and no inline base64', () => {
        const prompt = appendCodexImageAttachmentFiles('Describe this image.', [
            {
                id: 'a1',
                label: 'sketch',
                absolutePath: '/tmp/sketch.png',
                relativePath: '.happy/codex-attachments/s/sketch.png'
            }
        ]);

        expect(prompt).toContain('User attached image files:');
        expect(prompt).toContain('.happy/codex-attachments/s/sketch.png');
        expect(prompt).not.toContain('base64,');
        expect(prompt).toContain('inspect them directly from disk');
    });

    it('computes deterministic attachment session directory path', () => {
        const path = getCodexAttachmentSessionDir('/workspace', 'session-1');
        expect(path).toBe('/workspace/.happy/codex-attachments/session-1');
    });
});
