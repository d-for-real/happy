import { z } from 'zod';

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

// Backward compatibility aliases
export const UserImageAttachmentSchema = UserAttachmentSchema;
export type UserImageAttachment = UserAttachment;

const ATTACHMENT_TAG_START = '<happy-attachments>';
const ATTACHMENT_TAG_END = '</happy-attachments>';
const LEGACY_ATTACHMENT_TAG_START = '<happy-image-attachments>';
const LEGACY_ATTACHMENT_TAG_END = '</happy-image-attachments>';
const ATTACHMENT_REGEX = new RegExp(
  `(?:${ATTACHMENT_TAG_START}|${LEGACY_ATTACHMENT_TAG_START})([A-Za-z0-9+/=]+)(?:${ATTACHMENT_TAG_END}|${LEGACY_ATTACHMENT_TAG_END})\\s*$`,
  's'
);

export function encodeClaudePromptWithAttachments(text: string, attachments?: UserAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return text;
  }
  const encoded = Buffer.from(JSON.stringify(attachments), 'utf8').toString('base64');
  return `${text}\n\n${ATTACHMENT_TAG_START}${encoded}${ATTACHMENT_TAG_END}`;
}

export function decodeClaudePromptWithAttachments(prompt: string): { text: string; attachments: UserAttachment[] } {
  const match = prompt.match(ATTACHMENT_REGEX);
  if (!match || !match[1]) {
    return { text: prompt, attachments: [] };
  }

  const text = prompt.replace(ATTACHMENT_REGEX, '').trimEnd();
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    const result = z.array(UserAttachmentSchema).safeParse(parsed);
    if (result.success) {
      return { text, attachments: result.data };
    }
  } catch {
    // Ignore malformed attachment payloads and fall back to text-only mode.
  }
  return { text, attachments: [] };
}

export function isImageAttachment(attachment: Pick<UserAttachment, 'mimeType'>): boolean {
  return attachment.mimeType.toLowerCase().startsWith('image/');
}

export function appendAttachmentsAsMarkdown(text: string, attachments?: UserAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return text;
  }

  const lines: string[] = [text.trimEnd(), '', 'Attached files:'];
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const label = attachment.name || `attachment-${i + 1}`;
    const dimensions = attachment.width && attachment.height
      ? ` ${attachment.width}x${attachment.height}`
      : '';
    const size = attachment.sizeBytes ? ` ${Math.round(attachment.sizeBytes / 1024)}KB` : '';
    lines.push(`- ${label} (${attachment.mimeType}${dimensions ? `,${dimensions}` : ''}${size ? `,${size}` : ''})`);

    if (isImageAttachment(attachment)) {
      lines.push(`![${label}](data:${attachment.mimeType};base64,${attachment.data})`);
    } else {
      lines.push('```text');
      lines.push(`data:${attachment.mimeType};base64,${attachment.data}`);
      lines.push('```');
    }
  }
  lines.push('If any attached file format is unsupported, explicitly say so.');
  return lines.join('\n').trim();
}

// Backward compatibility alias.
export const appendImageAttachmentsAsMarkdown = appendAttachmentsAsMarkdown;
