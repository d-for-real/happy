import { describe, expect, it } from 'vitest';
import { createId, isCuid } from '@paralleldrive/cuid2';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    mapCodexProcessorMessageToSessionEnvelopes,
} from '../utils/sessionProtocolMapper';

describe('mapCodexMcpMessageToSessionEnvelopes', () => {
    it('starts and ends turns for task lifecycle events', () => {
        const started = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_started' }, { currentTurnId: null });

        expect(started.envelopes).toHaveLength(1);
        expect(started.envelopes[0].ev.t).toBe('turn-start');
        expect(started.envelopes[0].turn).toBe(started.currentTurnId);
        expect(started.envelopes[0].turn).not.toBe(started.envelopes[0].id);

        const ended = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_complete' }, { currentTurnId: started.currentTurnId });
        expect(ended.envelopes).toHaveLength(1);
        expect(ended.envelopes[0].ev.t).toBe('turn-end');
        if (ended.envelopes[0].ev.t === 'turn-end') {
            expect(ended.envelopes[0].ev.status).toBe('completed');
        }
        expect(ended.envelopes[0].turn).toBe(started.currentTurnId);
        expect(ended.currentTurnId).toBeNull();
    });

    it('maps abort lifecycle with cancelled turn-end status', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'turn_aborted' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({
            t: 'turn-end',
            status: 'cancelled',
        });
        expect(result.currentTurnId).toBeNull();
    });

    it('maps agent text messages with turn context', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'hello' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'hello' });
    });

    it('auto-starts a turn when agent text arrives without task_started', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'hello without lifecycle' },
            { currentTurnId: null }
        );

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0].ev).toEqual({ t: 'turn-start' });
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'hello without lifecycle' });
        expect(result.currentTurnId).toBeTruthy();
        expect(result.envelopes[0].turn).toBe(result.currentTurnId);
        expect(result.envelopes[1].turn).toBe(result.currentTurnId);
    });

    it('maps item_completed AgentMessage payloads to session text', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'item_completed',
                item: {
                    type: 'AgentMessage',
                    content: [{ type: 'Text', text: 'from item payload' }]
                }
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'from item payload' });
    });

    it('auto-starts a turn when item_completed text arrives without task_started', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'item_completed',
                item: {
                    type: 'AgentMessage',
                    content: [{ type: 'Text', text: 'late item payload' }]
                }
            },
            { currentTurnId: null }
        );

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0].ev).toEqual({ t: 'turn-start' });
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'late item payload' });
        expect(result.currentTurnId).toBeTruthy();
        expect(result.envelopes[1].turn).toBe(result.currentTurnId);
    });

    it('maps item_completed AgentMessage output_text payloads to session text', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'item_completed',
                item: {
                    type: 'AgentMessage',
                    content: [{ type: 'output_text', text: 'from output_text payload' }]
                }
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'from output_text payload' });
    });

    it('uses buffered agent_message_content_delta text when item_completed has no content text', () => {
        const fromDelta = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'agent_message_content_delta',
                item_id: 'msg-1',
                delta: 'Hello ',
            },
            { currentTurnId: 'turn-1' }
        );
        const fromSecondDelta = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'agent_message_content_delta',
                item_id: 'msg-1',
                delta: 'world!',
            },
            {
                currentTurnId: fromDelta.currentTurnId,
                startedSubagents: fromDelta.startedSubagents,
                activeSubagents: fromDelta.activeSubagents,
                providerSubagentToSessionSubagent: fromDelta.providerSubagentToSessionSubagent,
                completedAgentMessageCounts: fromDelta.completedAgentMessageCounts,
                agentMessageTextByItemId: fromDelta.agentMessageTextByItemId,
            }
        );
        const fromItemCompleted = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'item_completed',
                item: {
                    type: 'AgentMessage',
                    id: 'msg-1',
                    content: [],
                }
            },
            {
                currentTurnId: fromSecondDelta.currentTurnId,
                startedSubagents: fromSecondDelta.startedSubagents,
                activeSubagents: fromSecondDelta.activeSubagents,
                providerSubagentToSessionSubagent: fromSecondDelta.providerSubagentToSessionSubagent,
                completedAgentMessageCounts: fromSecondDelta.completedAgentMessageCounts,
                agentMessageTextByItemId: fromSecondDelta.agentMessageTextByItemId,
            }
        );

        expect(fromItemCompleted.envelopes).toHaveLength(1);
        expect(fromItemCompleted.envelopes[0].ev).toEqual({ t: 'text', text: 'Hello world!' });
    });

    it('suppresses duplicate agent_message after item_completed AgentMessage', () => {
        const fromItem = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'item_completed',
                item: {
                    type: 'AgentMessage',
                    content: [{ type: 'Text', text: 'dedupe me' }]
                }
            },
            { currentTurnId: 'turn-1' }
        );
        expect(fromItem.envelopes).toHaveLength(1);

        const fromAgentMessage = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'dedupe me' },
            {
                currentTurnId: fromItem.currentTurnId,
                startedSubagents: fromItem.startedSubagents,
                activeSubagents: fromItem.activeSubagents,
                providerSubagentToSessionSubagent: fromItem.providerSubagentToSessionSubagent,
                completedAgentMessageCounts: fromItem.completedAgentMessageCounts,
                agentMessageTextByItemId: fromItem.agentMessageTextByItemId,
            }
        );
        expect(fromAgentMessage.envelopes).toHaveLength(0);

        const nextUnique = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'new message' },
            {
                currentTurnId: fromAgentMessage.currentTurnId,
                startedSubagents: fromAgentMessage.startedSubagents,
                activeSubagents: fromAgentMessage.activeSubagents,
                providerSubagentToSessionSubagent: fromAgentMessage.providerSubagentToSessionSubagent,
                completedAgentMessageCounts: fromAgentMessage.completedAgentMessageCounts,
                agentMessageTextByItemId: fromAgentMessage.agentMessageTextByItemId,
            }
        );
        expect(nextUnique.envelopes).toHaveLength(1);
        expect(nextUnique.envelopes[0].ev).toEqual({ t: 'text', text: 'new message' });
    });

    it('maps parent call linkage to subagent field', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'subagent hello', parent_call_id: 'parent-call-1' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(2);
        const subagent = result.envelopes[1].subagent;
        expect(typeof subagent).toBe('string');
        expect(isCuid(subagent!)).toBe(true);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            ev: { t: 'start' },
        });
        expect(subagent).not.toBe('parent-call-1');
    });

    it('emits stop for active subagents before turn-end', () => {
        const subagent = createId();
        const activeSubagents = new Set<string>([subagent]);
        const startedSubagents = new Set<string>([subagent]);
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'task_complete' },
            { currentTurnId: 'turn-1', activeSubagents, startedSubagents }
        );

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            ev: { t: 'stop' },
        });
        expect(result.envelopes[1].ev).toEqual({
            t: 'turn-end',
            status: 'completed',
        });
    });

    it('maps exec command begin to tool-call-start', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_begin',
                call_id: 'call-1',
                command: 'ls -la',
                cwd: '/tmp',
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        const envelope = result.envelopes[0];
        expect(envelope.ev.t).toBe('tool-call-start');
        if (envelope.ev.t === 'tool-call-start') {
            expect(envelope.ev.call).toBe('call-1');
            expect(envelope.ev.name).toBe('CodexBash');
            expect(envelope.ev.title).toContain('Run `ls -la`');
            expect(envelope.ev.args).toEqual({ command: 'ls -la', cwd: '/tmp' });
        }
    });

    it('skips token_count messages', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'token_count', total_tokens: 10 },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(0);
        expect(result.currentTurnId).toBe('turn-1');
    });
});

describe('mapCodexProcessorMessageToSessionEnvelopes', () => {
    it('maps reasoning tool lifecycle to start/text/end session events', () => {
        const startEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'reasoning-1',
            name: 'CodexReasoning',
            input: { title: 'Plan changes' },
            id: 'legacy-id-1',
        }, { currentTurnId: 'turn-1' });

        expect(startEvents).toHaveLength(1);
        expect(startEvents[0].ev.t).toBe('tool-call-start');

        const endEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call-result',
            callId: 'reasoning-1',
            output: { content: 'Step 1, Step 2', status: 'completed' },
            id: 'legacy-id-2',
        }, { currentTurnId: 'turn-1' });

        expect(endEvents).toHaveLength(2);
        expect(endEvents[0].ev.t).toBe('text');
        if (endEvents[0].ev.t === 'text') {
            expect(endEvents[0].ev.thinking).toBe(true);
        }
        expect(endEvents[1].ev).toEqual({ t: 'tool-call-end', call: 'reasoning-1' });
    });

    it('maps reasoning text to thinking text event', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'reasoning',
            message: 'Working through options',
            id: 'legacy-id-3',
        }, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev).toEqual({
            t: 'text',
            text: 'Working through options',
            thinking: true,
        });
    });
});
