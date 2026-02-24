import { randomUUID } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import type { ReasoningOutput } from './reasoningProcessor';
import type { DiffToolCall, DiffToolResult } from './diffProcessor';
import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@slopus/happy-wire';

export type CodexTurnState = {
    currentTurnId: string | null;
    startedSubagents?: Set<string>;
    activeSubagents?: Set<string>;
    providerSubagentToSessionSubagent?: Map<string, string>;
    completedAgentMessageCounts?: Map<string, number>;
    agentMessageTextByItemId?: Map<string, string>;
};

type CodexMapperResult = {
    currentTurnId: string | null;
    startedSubagents: Set<string>;
    activeSubagents: Set<string>;
    providerSubagentToSessionSubagent: Map<string, string>;
    completedAgentMessageCounts: Map<string, number>;
    agentMessageTextByItemId: Map<string, string>;
    envelopes: SessionEnvelope[];
};

type LegacyToolLikeMessage = {
    type: 'tool-call' | 'tool-call-result';
    callId: string;
    name?: string;
    input?: unknown;
    output?: {
        content?: string;
        status?: 'completed' | 'canceled';
    };
};

type TurnEndStatus = 'completed' | 'failed' | 'cancelled';

function getStartedSubagents(state: CodexTurnState): Set<string> {
    return state.startedSubagents ?? new Set<string>();
}

function getActiveSubagents(state: CodexTurnState): Set<string> {
    return state.activeSubagents ?? new Set<string>();
}

function getProviderSubagentToSessionSubagent(state: CodexTurnState): Map<string, string> {
    return state.providerSubagentToSessionSubagent ?? new Map<string, string>();
}

function getCompletedAgentMessageCounts(state: CodexTurnState): Map<string, number> {
    return state.completedAgentMessageCounts ?? new Map<string, number>();
}

function getAgentMessageTextByItemId(state: CodexTurnState): Map<string, string> {
    return state.agentMessageTextByItemId ?? new Map<string, string>();
}

function maybeEmitSubagentStart(
    subagent: string | undefined,
    opts: CreateEnvelopeOptions,
    startedSubagents: Set<string>,
    activeSubagents: Set<string>,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent || startedSubagents.has(subagent)) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'start' }, { ...opts, subagent }));
    startedSubagents.add(subagent);
    activeSubagents.add(subagent);
}

function emitSubagentStops(
    opts: CreateEnvelopeOptions,
    startedSubagents: Set<string>,
    activeSubagents: Set<string>,
): SessionEnvelope[] {
    const envelopes: SessionEnvelope[] = [];
    for (const subagent of activeSubagents) {
        envelopes.push(createEnvelope('agent', { t: 'stop' }, { ...opts, subagent }));
    }
    activeSubagents.clear();
    startedSubagents.clear();
    return envelopes;
}

function buildEnvelopeOptions(currentTurnId: string | null, subagent?: string): CreateEnvelopeOptions {
    return {
        ...(currentTurnId ? { turn: currentTurnId } : {}),
        ...(subagent ? { subagent } : {}),
    };
}

function ensureTurnId(currentTurnId: string | null, envelopes: SessionEnvelope[]): string {
    if (currentTurnId) {
        return currentTurnId;
    }
    const turnId = createId();
    envelopes.push(createEnvelope('agent', { t: 'turn-start' }, { turn: turnId }));
    return turnId;
}

function pickProviderSubagent(message: Record<string, unknown>): string | undefined {
    const candidates = [message.subagent, message.parent_call_id, message.parentCallId];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
    }
    return undefined;
}

function resolveSessionSubagent(
    message: Record<string, unknown>,
    providerSubagentToSessionSubagent: Map<string, string>,
): string | undefined {
    const providerSubagent = pickProviderSubagent(message);
    if (!providerSubagent) {
        return undefined;
    }

    const existing = providerSubagentToSessionSubagent.get(providerSubagent);
    if (existing) {
        return existing;
    }

    const created = createId();
    providerSubagentToSessionSubagent.set(providerSubagent, created);
    return created;
}

function pickCallId(message: Record<string, unknown>): string {
    const callId = message.call_id ?? message.callId;
    if (typeof callId === 'string' && callId.length > 0) {
        return callId;
    }
    return randomUUID();
}

function summarizeCommand(command: unknown): string | null {
    if (typeof command === 'string' && command.trim().length > 0) {
        return command;
    }
    if (Array.isArray(command)) {
        const cmd = command.map(v => String(v)).join(' ').trim();
        return cmd.length > 0 ? cmd : null;
    }
    return null;
}

function commandToTitle(command: string | null): string {
    if (!command) {
        return 'Run command';
    }
    const short = command.length > 80 ? `${command.slice(0, 77)}...` : command;
    return `Run \`${short}\``;
}

function patchDescription(changes: unknown): string {
    if (!changes || typeof changes !== 'object') {
        return 'Applying patch';
    }
    const fileCount = Object.keys(changes as Record<string, unknown>).length;
    if (fileCount === 1) {
        return 'Applying patch to 1 file';
    }
    return `Applying patch to ${fileCount} files`;
}

function pickTurnEndStatus(message: Record<string, unknown>, type: unknown): TurnEndStatus {
    const rawStatus = message.status;
    if (rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled') {
        return rawStatus;
    }
    if (rawStatus === 'canceled') {
        return 'cancelled';
    }

    // Abort events are treated as cancelled unless they explicitly look like failures.
    if (type === 'turn_aborted') {
        const reason = message.reason;
        const error = message.error;
        if ((typeof reason === 'string' && /(fail|error)/i.test(reason))
            || (typeof error === 'string' && error.length > 0)
            || (error !== undefined && error !== null && typeof error === 'object')) {
            return 'failed';
        }
        return 'cancelled';
    }

    if (message.error !== undefined && message.error !== null) {
        return 'failed';
    }

    return 'completed';
}

function extractAgentTextFromItemCompleted(message: Record<string, unknown>): string | null {
    if (!message.item || typeof message.item !== 'object') {
        return null;
    }

    const item = message.item as Record<string, unknown>;
    if (item.type !== 'AgentMessage') {
        return null;
    }

    if (!Array.isArray(item.content)) {
        return null;
    }

    let text = '';
    for (const chunk of item.content) {
        if (!chunk || typeof chunk !== 'object') {
            continue;
        }
        const part = chunk as Record<string, unknown>;
        const partType = typeof part.type === 'string' ? part.type.toLowerCase() : '';
        if ((partType === 'text' || partType === 'output_text') && typeof part.text === 'string') {
            text += part.text;
        }
    }

    return text.length > 0 ? text : null;
}

function addCompletedMessageCount(counts: Map<string, number>, text: string): void {
    counts.set(text, (counts.get(text) ?? 0) + 1);
}

function consumeCompletedMessageCount(counts: Map<string, number>, text: string): boolean {
    const count = counts.get(text) ?? 0;
    if (count <= 0) {
        return false;
    }
    if (count === 1) {
        counts.delete(text);
    } else {
        counts.set(text, count - 1);
    }
    return true;
}

function getItemIdFromAgentMessageContentDelta(message: Record<string, unknown>): string | null {
    const raw = message.item_id ?? message.itemId;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function getItemIdFromItemCompleted(message: Record<string, unknown>): string | null {
    if (!message.item || typeof message.item !== 'object') {
        return null;
    }
    const raw = (message.item as Record<string, unknown>).id;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function appendAgentMessageDelta(agentMessageTextByItemId: Map<string, string>, itemId: string, delta: string): void {
    const previous = agentMessageTextByItemId.get(itemId) ?? '';
    agentMessageTextByItemId.set(itemId, previous + delta);
}

function consumeAgentMessageText(agentMessageTextByItemId: Map<string, string>, itemId: string | null): string | null {
    if (!itemId) {
        return null;
    }
    const text = agentMessageTextByItemId.get(itemId) ?? null;
    if (text !== null) {
        agentMessageTextByItemId.delete(itemId);
    }
    return text && text.length > 0 ? text : null;
}

export function mapCodexMcpMessageToSessionEnvelopes(message: Record<string, unknown>, state: CodexTurnState): CodexMapperResult {
    const type = message.type;
    const startedSubagents = getStartedSubagents(state);
    const activeSubagents = getActiveSubagents(state);
    const providerSubagentToSessionSubagent = getProviderSubagentToSessionSubagent(state);
    const completedAgentMessageCounts = getCompletedAgentMessageCounts(state);
    const agentMessageTextByItemId = getAgentMessageTextByItemId(state);

    if (type === 'task_started') {
        const turnId = createId();
        const turnStart = createEnvelope('agent', { t: 'turn-start' }, { turn: turnId });
        startedSubagents.clear();
        activeSubagents.clear();
        providerSubagentToSessionSubagent.clear();
        completedAgentMessageCounts.clear();
        agentMessageTextByItemId.clear();
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes: [turnStart],
        };
    }

    if (type === 'task_complete' || type === 'turn_aborted') {
        if (!state.currentTurnId) {
            return {
                currentTurnId: null,
                startedSubagents,
                activeSubagents,
                providerSubagentToSessionSubagent,
                completedAgentMessageCounts,
                agentMessageTextByItemId,
                envelopes: [],
            };
        }

        const lifecycleOpts = { turn: state.currentTurnId } satisfies CreateEnvelopeOptions;
        providerSubagentToSessionSubagent.clear();
        completedAgentMessageCounts.clear();
        agentMessageTextByItemId.clear();
        return {
            currentTurnId: null,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes: [
                ...emitSubagentStops(lifecycleOpts, startedSubagents, activeSubagents),
                createEnvelope('agent', {
                    t: 'turn-end',
                    status: pickTurnEndStatus(message, type),
                }, lifecycleOpts),
            ],
        };
    }

    if (type === 'token_count') {
        return {
            currentTurnId: state.currentTurnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes: [],
        };
    }

    const subagent = resolveSessionSubagent(message, providerSubagentToSessionSubagent);

    if (type === 'agent_message_content_delta') {
        const itemId = getItemIdFromAgentMessageContentDelta(message);
        const delta = typeof message.delta === 'string' ? message.delta : null;
        if (itemId && delta && delta.length > 0) {
            appendAgentMessageDelta(agentMessageTextByItemId, itemId, delta);
        }
        return {
            currentTurnId: state.currentTurnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes: [],
        };
    }

    if (type === 'item_completed') {
        const itemId = getItemIdFromItemCompleted(message);
        const completedText = extractAgentTextFromItemCompleted(message) ?? consumeAgentMessageText(agentMessageTextByItemId, itemId);
        if (!completedText) {
            return {
                currentTurnId: state.currentTurnId,
                startedSubagents,
                activeSubagents,
                providerSubagentToSessionSubagent,
                completedAgentMessageCounts,
                agentMessageTextByItemId,
                envelopes: [],
            };
        }

        addCompletedMessageCount(completedAgentMessageCounts, completedText);
        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text: completedText }, opts));
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'agent_message') {
        if (typeof message.message !== 'string') {
            return {
                currentTurnId: state.currentTurnId,
                startedSubagents,
                activeSubagents,
                providerSubagentToSessionSubagent,
                completedAgentMessageCounts,
                agentMessageTextByItemId,
                envelopes: [],
            };
        }

        if (consumeCompletedMessageCount(completedAgentMessageCounts, message.message)) {
            return {
                currentTurnId: state.currentTurnId,
                startedSubagents,
                activeSubagents,
                providerSubagentToSessionSubagent,
                completedAgentMessageCounts,
                agentMessageTextByItemId,
                envelopes: [],
            };
        }

        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text: message.message }, opts));
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'agent_reasoning' || type === 'agent_reasoning_delta') {
        const text = typeof message.text === 'string'
            ? message.text
            : (typeof message.delta === 'string' ? message.delta : null);

        if (!text) {
            return {
                currentTurnId: state.currentTurnId,
                startedSubagents,
                activeSubagents,
                providerSubagentToSessionSubagent,
                completedAgentMessageCounts,
                agentMessageTextByItemId,
                envelopes: [],
            };
        }

        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text, thinking: true }, opts));
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'exec_command_begin' || type === 'exec_approval_request') {
        const call = pickCallId(message);
        const { call_id: _callIdSnake, callId: _callIdCamel, type: _type, ...args } = message;

        const command = summarizeCommand((args as Record<string, unknown>).command);
        const description = typeof (args as Record<string, unknown>).description === 'string'
            ? ((args as Record<string, string>).description)
            : (command ?? 'Execute command');

        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexBash',
                title: commandToTitle(command),
                description,
                args: args as Record<string, unknown>,
            }, opts)
        );
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'exec_command_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, opts));
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'patch_apply_begin') {
        const call = pickCallId(message);
        const autoApproved = (message as { auto_approved?: unknown }).auto_approved;
        const changes = (message as { changes?: unknown }).changes;

        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexPatch',
                title: 'Apply patch',
                description: patchDescription(changes),
                args: {
                    auto_approved: autoApproved,
                    changes,
                },
            }, opts)
        );
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    if (type === 'patch_apply_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        const turnId = ensureTurnId(state.currentTurnId, envelopes);
        const opts = buildEnvelopeOptions(turnId, subagent);
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'tool-call-end', call }, opts));
        return {
            currentTurnId: turnId,
            startedSubagents,
            activeSubagents,
            providerSubagentToSessionSubagent,
            completedAgentMessageCounts,
            agentMessageTextByItemId,
            envelopes,
        };
    }

    return {
        currentTurnId: state.currentTurnId,
        startedSubagents,
        activeSubagents,
        providerSubagentToSessionSubagent,
        completedAgentMessageCounts,
        agentMessageTextByItemId,
        envelopes: [],
    };
}

export function mapCodexProcessorMessageToSessionEnvelopes(
    message: ReasoningOutput | DiffToolCall | DiffToolResult,
    state: CodexTurnState,
): SessionEnvelope[] {
    const toolLikeMessage = message as LegacyToolLikeMessage;
    const opts = buildEnvelopeOptions(state.currentTurnId);

    if (message.type === 'reasoning') {
        return [createEnvelope('agent', {
            t: 'text',
            text: message.message,
            thinking: true,
        }, opts)];
    }

    if (message.type === 'tool-call') {
        const title = typeof (toolLikeMessage.input as { title?: unknown } | undefined)?.title === 'string'
            ? (toolLikeMessage.input as { title: string }).title
            : `${toolLikeMessage.name || 'Tool'} call`;

        return [createEnvelope('agent', {
            t: 'tool-call-start',
            call: toolLikeMessage.callId,
            name: toolLikeMessage.name || 'unknown',
            title,
            description: title,
            args: (toolLikeMessage.input && typeof toolLikeMessage.input === 'object'
                ? toolLikeMessage.input
                : {}) as Record<string, unknown>,
        }, opts)];
    }

    if (message.type === 'tool-call-result') {
        const envelopes: SessionEnvelope[] = [];
        const content = toolLikeMessage.output?.content;
        if (typeof content === 'string' && content.trim().length > 0) {
            envelopes.push(createEnvelope('agent', {
                t: 'text',
                text: content,
                thinking: true,
            }, opts));
        }
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-end',
            call: toolLikeMessage.callId,
        }, opts));
        return envelopes;
    }

    return [];
}
