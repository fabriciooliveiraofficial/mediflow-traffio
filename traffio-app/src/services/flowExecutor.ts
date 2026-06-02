import type { FlowDSL, FlowNode } from './flowDSL';
import { Node, Edge } from 'reactflow';
import { supabase } from '../lib/supabase';

export interface FlowSession {
    tenant_id: string;
    flow_id: string;
    session_id: string;
    current_node_id: string;
    context: Record<string, any>;
    status: 'active' | 'completed' | 'failed' | 'handoff';
}

export interface ExecutionResult {
    node: FlowNode;
    output: any;
    session: FlowSession;
    error?: string;
}

/**
 * FlowExecutor
 * Deterministic engine for executing Flow DSL 2.0.
 */
export class FlowExecutor {

    static async executeStep(dsl: FlowDSL, session: FlowSession, input?: string): Promise<ExecutionResult> {
        const startTime = Date.now();
        const node = dsl.nodes.find(n => n.id === session.current_node_id);

        if (!node) {
            return { node: {} as FlowNode, output: null, session, error: `Node ${session.current_node_id} not found.` };
        }

        let output: any = null;
        let nextNodeId: string | undefined = node.next;

        try {
            // 1. Process Node Intent/Logic
            switch (node.type) {
                case 'message':
                    output = { type: 'text', text: node.content };
                    break;

                case 'menu':
                    output = { type: 'menu', text: node.content?.title, options: node.choices };
                    // If input matches a choice, move to it
                    if (input && node.choices) {
                        const choice = node.choices.find(c => c.label.toLowerCase() === input.toLowerCase());
                        if (choice) nextNodeId = choice.next;
                    }
                    break;

                case 'input':
                    // Store input in context
                    if (input && node.metadata?.variable) {
                        session.context[node.metadata.variable] = input;
                    }
                    output = { type: 'text', text: node.content };
                    break;

                case 'condition':
                    const isTrue = this.evaluateCondition(node.condition, session.context);
                    nextNodeId = isTrue ? node.condition?.true_next : node.condition?.false_next;
                    break;

                case 'db_query':
                    const queryResult = await this.executeDbQuery(node.db_config, session.context);
                    if (node.db_config?.result_mapping) {
                        Object.entries(node.db_config.result_mapping).forEach(([col, varName]) => {
                            session.context[varName] = queryResult?.[col];
                        });
                    }
                    break;

                case 'delay':
                    const delayMs = node.content?.ms || 5000;
                    output = { type: 'delay', ms: delayMs };
                    // For a real executor, this would pause the session or schedule a task
                    break;

                case 'webhook':
                    const webhookResult = await this.executeWebhook(node.content?.url, session.context);
                    session.context[node.id + '_response'] = webhookResult;
                    break;

                case 'split_percentual':
                    nextNodeId = this.executeSplit(node.choices || []);
                    break;

                case 'human_handoff':
                    session.status = 'handoff';
                    output = { type: 'handoff', message: node.content };
                    break;

                case 'ai_orchestrator':
                    // In a real scenario, this calls Gemini
                    // For now, we return a prompt for the AI agent to handle
                    output = { type: 'ai_prompt', prompt: node.ai_config?.system_prompt };
                    break;

                case 'end':
                    session.status = 'completed';
                    break;
            }

            // 2. Logging (Observability)
            await this.logExecution(session.tenant_id, dsl.flow_id, session.session_id, node, input, output, Date.now() - startTime);

            // 3. Update Session State
            if (nextNodeId) session.current_node_id = nextNodeId;

            return { node, output, session };

        } catch (err: any) {
            console.error(`Flow execution error at ${node.id}:`, err);
            // Handle fallback
            if (node.runtime?.fallback_node_id || node.fallback) {
                session.current_node_id = node.runtime?.fallback_node_id || node.fallback!;
            }
            return { node, output: null, session, error: err.message };
        }
    }

    private static evaluateCondition(cond: any, context: any): boolean {
        if (!cond) return true;
        const val = context[cond.variable];
        const operator = cond.operator as string;
        switch (operator) {
            case '==': return val == cond.value;
            case '!=': return val != cond.value;
            case '>': return val > cond.value;
            case '<': return val < cond.value;
            case 'contains': return String(val).includes(cond.value);
            case 'matches_regex': return new RegExp(cond.value).test(String(val));
            default: return false;
        }
    }

    private static async executeDbQuery(config: any, context: any) {
        if (!config) return null;
        const { data } = await supabase
            .from(config.table)
            .select('*')
            .eq(config.filter_column, context[config.filter_value] || config.filter_value)
            .single();
        return data;
    }

    private static async executeWebhook(url: string, context: any) {
        if (!url) return null;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(context)
        });
        return response.json();
    }

    private static executeSplit(choices: any[]): string {
        const totalWeight = choices.reduce((sum, c) => sum + (c.weight || 1), 0);
        let random = Math.random() * totalWeight;
        for (const choice of choices) {
            random -= (choice.weight || 1);
            if (random <= 0) return choice.next;
        }
        return choices[0]?.next;
    }

    private static async logExecution(tenantId: string, flowId: string, sessionId: string, node: FlowNode, input: any, output: any, duration: number) {
        await supabase.from('bot_execution_logs').insert({
            tenant_id: tenantId,
            flow_id: flowId,
            session_id: sessionId,
            node_id: node.id,
            node_type: node.type,
            input: JSON.stringify(input),
            output: output,
            duration_ms: duration
        });
    }
}
