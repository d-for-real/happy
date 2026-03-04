import { z } from 'zod';

export const MESSAGE_ATTACHMENT_MAX_COUNT = 4;
export const MESSAGE_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const MESSAGE_ATTACHMENT_TOTAL_MAX_BYTES = 6 * 1024 * 1024;
export const MESSAGE_IMAGE_MAX_DIMENSION = 1600;

export const UserAttachmentSchema = z.object({
    id: z.string(),
    mimeType: z.string(),
    data: z.string(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    name: z.string().optional(),
    sizeBytes: z.number().int().positive().optional(),
}).passthrough();

export type UserAttachment = z.infer<typeof UserAttachmentSchema>;

// Backward compatibility aliases for existing imports.
export const MESSAGE_IMAGE_MAX_COUNT = MESSAGE_ATTACHMENT_MAX_COUNT;
export const MESSAGE_IMAGE_MAX_BYTES = MESSAGE_ATTACHMENT_MAX_BYTES;
export const MESSAGE_IMAGE_TOTAL_MAX_BYTES = MESSAGE_ATTACHMENT_TOTAL_MAX_BYTES;
export const UserImageAttachmentSchema = UserAttachmentSchema;
export type UserImageAttachment = UserAttachment;

export function estimateBase64Bytes(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
    return Math.floor((base64.length * 3) / 4) - padding;
}

export function isImageAttachment(attachment: Pick<UserAttachment, 'mimeType'>): boolean {
    return attachment.mimeType.toLowerCase().startsWith('image/');
}

export function toAttachmentDataUri(attachment: Pick<UserAttachment, 'mimeType' | 'data'>): string {
    return `data:${attachment.mimeType};base64,${attachment.data}`;
}

// Backward compatibility alias.
export const toImageDataUri = toAttachmentDataUri;
