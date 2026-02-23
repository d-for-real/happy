import { describe, expect, it } from 'vitest';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildCodexElicitationResult, resolveCodexPermissionRequestId } from '../codexMcpClient';

describe('resolveCodexPermissionRequestId', () => {
    it('prefers codex_call_id', () => {
        const result = resolveCodexPermissionRequestId({
            params: {
                codex_call_id: 'call-1',
                codex_mcp_tool_call_id: 'tool-1',
                codex_event_id: 'event-1'
            }
        });

        expect(result).toEqual({
            id: 'call-1',
            source: 'codex_call_id'
        });
    });

    it('falls back to codex_mcp_tool_call_id', () => {
        const result = resolveCodexPermissionRequestId({
            params: {
                codex_mcp_tool_call_id: 'tool-1',
                codex_event_id: 'event-1'
            }
        });

        expect(result).toEqual({
            id: 'tool-1',
            source: 'codex_mcp_tool_call_id'
        });
    });

    it('falls back to codex_event_id', () => {
        const result = resolveCodexPermissionRequestId({
            params: {
                codex_event_id: 'event-1'
            }
        });

        expect(result).toEqual({
            id: 'event-1',
            source: 'codex_event_id'
        });
    });

    it('falls back to json-rpc request.id', () => {
        const result = resolveCodexPermissionRequestId({
            id: 42,
            params: {
                message: 'Allow command?'
            }
        });

        expect(result).toEqual({
            id: '42',
            source: 'request.id'
        });
    });

    it('generates uuid when request has no usable id fields', () => {
        const result = resolveCodexPermissionRequestId({
            params: {
                message: 'Allow command?',
                requestedSchema: { type: 'object' }
            }
        });

        expect(result.source).toBe('generated');
        expect(result.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
    });
});

describe('buildCodexElicitationResult', () => {
    it('returns MCP accept action for approved decision', () => {
        const result = buildCodexElicitationResult('approved', {
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: {
                    decision: {
                        type: 'string',
                        enum: ['approved', 'approved_for_session', 'denied', 'abort']
                    }
                }
            }
        });

        expect(result).toEqual({
            action: 'accept',
            content: { decision: 'approved' },
            decision: 'approved'
        });
    });

    it('returns MCP accept action for approved_for_session decision', () => {
        const result = buildCodexElicitationResult('approved_for_session', {
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: {
                    decision: {
                        type: 'string',
                        enum: ['approved', 'approved_for_session', 'denied', 'abort']
                    }
                }
            }
        });

        expect(result).toEqual({
            action: 'accept',
            content: { decision: 'approved_for_session' },
            decision: 'approved_for_session'
        });
    });

    it('omits content when decision field is not present in requestedSchema', () => {
        const result = buildCodexElicitationResult('approved', {
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: {
                    allow: { type: 'boolean' }
                }
            }
        });

        expect(result).toEqual({
            action: 'accept',
            decision: 'approved'
        });
    });

    it('maps denied decision to MCP decline action', () => {
        const result = buildCodexElicitationResult('denied');

        expect(result).toEqual({
            action: 'decline',
            decision: 'denied'
        });
    });

    it('maps abort decision to MCP cancel action', () => {
        const result = buildCodexElicitationResult('abort');

        expect(result).toEqual({
            action: 'cancel',
            decision: 'abort'
        });
    });

    it('always produces a value accepted by ElicitResultSchema', () => {
        const results = [
            buildCodexElicitationResult('approved', {
                mode: 'form',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        decision: {
                            type: 'string',
                            enum: ['approved', 'approved_for_session', 'denied', 'abort']
                        }
                    }
                }
            }),
            buildCodexElicitationResult('approved_for_session', {
                mode: 'form',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        decision: {
                            type: 'string',
                            enum: ['approved', 'approved_for_session', 'denied', 'abort']
                        }
                    }
                }
            }),
            buildCodexElicitationResult('denied'),
            buildCodexElicitationResult('abort')
        ];

        for (const result of results) {
            const parsed = ElicitResultSchema.safeParse(result);
            expect(parsed.success).toBe(true);
        }
    });
});
