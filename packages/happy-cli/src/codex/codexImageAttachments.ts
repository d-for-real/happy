import fs from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { UserImageAttachment } from '@/api/userAttachments';

export interface CodexImageAttachmentFile {
    id: string;
    label: string;
    absolutePath: string;
    relativePath: string;
}

function sanitizeBaseName(name: string | undefined, fallback: string): string {
    const candidate = basename(name || fallback);
    const withoutExtension = candidate.replace(/\.[^.]+$/, '');
    const cleaned = withoutExtension
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!cleaned) {
        return fallback;
    }
    return cleaned.slice(0, 48);
}

function extensionForMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
    if (normalized === 'image/png') return '.png';
    if (normalized === 'image/webp') return '.webp';
    if (normalized === 'image/gif') return '.gif';

    const subtype = normalized.split('/')[1];
    if (!subtype) return '.img';
    const cleanedSubtype = subtype.replace(/[^a-z0-9.+-]/g, '');
    if (!cleanedSubtype) return '.img';
    return `.${cleanedSubtype}`;
}

function sanitizeId(id: string): string {
    const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleaned) {
        return 'attachment';
    }
    return cleaned.slice(0, 16);
}

export function getCodexAttachmentSessionDir(workspaceRoot: string, sessionTag: string): string {
    return resolve(workspaceRoot, '.happy', 'codex-attachments', sessionTag);
}

export function materializeCodexImageAttachments(opts: {
    attachments?: UserImageAttachment[];
    workspaceRoot: string;
    sessionTag: string;
}): CodexImageAttachmentFile[] {
    const attachments = opts.attachments || [];
    if (attachments.length === 0) {
        return [];
    }

    const rootDir = getCodexAttachmentSessionDir(opts.workspaceRoot, opts.sessionTag);
    fs.mkdirSync(rootDir, { recursive: true });

    const materialized: CodexImageAttachmentFile[] = [];

    for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        const fallbackLabel = `image-${i + 1}`;
        const safeBaseName = sanitizeBaseName(attachment.name, fallbackLabel);
        const safeId = sanitizeId(attachment.id);
        const extension = extensionForMimeType(attachment.mimeType);
        const fileName = `${String(i + 1).padStart(2, '0')}-${safeBaseName}-${safeId}${extension}`;
        const absolutePath = resolve(rootDir, fileName);
        const buffer = Buffer.from(attachment.data, 'base64');

        fs.writeFileSync(absolutePath, buffer);

        const relativePath = relative(opts.workspaceRoot, absolutePath) || fileName;
        materialized.push({
            id: attachment.id,
            label: attachment.name || fallbackLabel,
            absolutePath,
            relativePath
        });
    }

    return materialized;
}

export function appendCodexImageAttachmentFiles(text: string, files: CodexImageAttachmentFile[]): string {
    if (files.length === 0) {
        return text;
    }

    const trimmed = text.trimEnd();
    const lines: string[] = [];

    if (trimmed.length > 0) {
        lines.push(trimmed, '');
    }

    lines.push('User attached image files:');
    for (const file of files) {
        lines.push(`- ${file.label}: ${file.relativePath}`);
    }
    lines.push('Treat these as user-provided images and inspect them directly from disk before answering.');

    return lines.join('\n');
}
