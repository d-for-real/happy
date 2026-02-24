import { z } from 'zod';

export const UserImageAttachmentSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  data: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  name: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
}).passthrough();

export type UserImageAttachment = z.infer<typeof UserImageAttachmentSchema>;

const CLAUDE_ATTACHMENT_TAG_START = '<happy-image-attachments>';
const CLAUDE_ATTACHMENT_TAG_END = '</happy-image-attachments>';
const CLAUDE_ATTACHMENT_REGEX = new RegExp(
  `${CLAUDE_ATTACHMENT_TAG_START}([A-Za-z0-9+/=]+)${CLAUDE_ATTACHMENT_TAG_END}\\s*$`,
  's'
);

export function encodeClaudePromptWithAttachments(text: string, attachments?: UserImageAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return text;
  }
  const encoded = Buffer.from(JSON.stringify(attachments), 'utf8').toString('base64');
  return `${text}\n\n${CLAUDE_ATTACHMENT_TAG_START}${encoded}${CLAUDE_ATTACHMENT_TAG_END}`;
}

export function decodeClaudePromptWithAttachments(prompt: string): { text: string; attachments: UserImageAttachment[] } {
  const match = prompt.match(CLAUDE_ATTACHMENT_REGEX);
  if (!match || !match[1]) {
    return { text: prompt, attachments: [] };
  }

  const text = prompt.replace(CLAUDE_ATTACHMENT_REGEX, '').trimEnd();
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    const result = z.array(UserImageAttachmentSchema).safeParse(parsed);
    if (result.success) {
      return { text, attachments: result.data };
    }
  } catch {
    // Ignore malformed attachment payloads and fall back to text-only mode.
  }
  return { text, attachments: [] };
}

export function appendImageAttachmentsAsMarkdown(text: string, attachments?: UserImageAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return text;
  }

  const lines: string[] = [text.trimEnd(), '', 'Attached images:'];
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    const label = attachment.name || `image-${i + 1}`;
    const size = attachment.width && attachment.height
      ? ` (${attachment.width}x${attachment.height})`
      : '';
    lines.push(`- ${label}${size}`);
    lines.push(`![${label}](data:${attachment.mimeType};base64,${attachment.data})`);
  }
  return lines.join('\n').trim();
}
