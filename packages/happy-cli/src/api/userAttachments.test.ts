import { describe, expect, it } from 'vitest';
import {
  appendAttachmentsAsMarkdown,
  decodeClaudePromptWithAttachments,
  encodeClaudePromptWithAttachments,
} from './userAttachments';

describe('userAttachments', () => {
  it('encodes and decodes attachments with the new tag', () => {
    const prompt = encodeClaudePromptWithAttachments('Analyze', [
      {
        id: '1',
        mimeType: 'application/pdf',
        data: Buffer.from('pdf').toString('base64'),
        name: 'doc.pdf',
      },
    ]);

    expect(prompt).toContain('<happy-attachments>');

    const decoded = decodeClaudePromptWithAttachments(prompt);
    expect(decoded.text).toBe('Analyze');
    expect(decoded.attachments).toHaveLength(1);
    expect(decoded.attachments[0].mimeType).toBe('application/pdf');
  });

  it('decodes legacy image attachment tags', () => {
    const attachments = [
      {
        id: 'a1',
        mimeType: 'image/png',
        data: Buffer.from('img').toString('base64'),
        name: 'img.png',
      },
    ];
    const encoded = Buffer.from(JSON.stringify(attachments), 'utf8').toString('base64');
    const prompt = `Hello\n\n<happy-image-attachments>${encoded}</happy-image-attachments>`;

    const decoded = decodeClaudePromptWithAttachments(prompt);
    expect(decoded.text).toBe('Hello');
    expect(decoded.attachments).toEqual(attachments);
  });

  it('renders image and non-image attachments into markdown', () => {
    const markdown = appendAttachmentsAsMarkdown('Check these', [
      {
        id: 'img',
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
        name: 'image.png',
      },
      {
        id: 'txt',
        mimeType: 'text/plain',
        data: 'aGVsbG8=',
        name: 'note.txt',
      },
    ]);

    expect(markdown).toContain('Attached files:');
    expect(markdown).toContain('![image.png](data:image/png;base64,aW1hZ2U=)');
    expect(markdown).toContain('data:text/plain;base64,aGVsbG8=');
    expect(markdown).toContain('unsupported');
  });
});
