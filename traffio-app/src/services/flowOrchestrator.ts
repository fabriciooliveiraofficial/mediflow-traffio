import { supabase } from '../lib/supabase';
import { zapiService } from './zapiService';

interface FlowContext {
    tenantId: string;
    phone: string;
    message: string;
    sessionId?: string;
    variables: Record<string, any>;
}

export class FlowOrchestrator {
    private simulatorMode = false;
    private simulatorHandler?: (type: string, content: any) => Promise<void>;
    private simulatorState: any = null; // Store session state in memory for simulation

    /**
     * Enable Simulation Mode
     * @param handler Callback to receive bot outputs instead of sending to WhatsApp
     */
    setSimulatorMode(handler: (type: string, content: any) => Promise<void>) {
        this.simulatorMode = true;
        this.simulatorHandler = handler;
        this.simulatorState = {
            currentNodeId: null,
            variables: {}
        };
    }

    /**
     * Main Entry Point: Receives a message and decides what to do.
     */
    async handleMessage(tenantId: string, phone: string, message: string, flowDefinition?: any) {
        let zapiConfig: any = null;

        // 0. Fetch Tenant Credentials (only if NOT in simulation)
        if (!this.simulatorMode) {
            const tenant = await this.getTenantConfig(tenantId);
            if (!tenant || !tenant.zapi_instance_id || !tenant.zapi_token || !tenant.zapi_client_token) {
                console.error(`[FlowOrchestrator] Missing Z-API credentials for tenant ${tenantId}`);
                return;
            }
            zapiConfig = {
                instanceId: tenant.zapi_instance_id,
                token: tenant.zapi_token,
                clientToken: tenant.zapi_client_token
            };
        }

        // 1. Find or Create Session
        let session: any;
        let flow: any;

        if (this.simulatorMode && flowDefinition) {
            // Simulation: Use in-memory session and provided definition
            session = {
                id: 'sim-session',
                current_node_id: this.simulatorState.currentNodeId || flowDefinition.startNodeId || 'start-1',
                contact_phone: phone,
                variables: this.simulatorState.variables
            };
            flow = { definition: flowDefinition };
        } else {
            // Real: Fetch from DB
            session = await this.getSession(tenantId, phone);
            if (!session) {
                session = await this.startNewSession(tenantId, phone);
            }
            if (!session) return; // Error creating session
            flow = await this.getFlow(session.current_flow_id);
        }

        if (!flow) {
            console.error('Flow not found for session', session?.id);
            return;
        }

        // 2. Determine Current Node
        // If it's a new session or reset, ensure we start at startNode
        const currentNodeId = session.current_node_id;

        // Find node in definition
        let currentNode = flow.definition.nodes.find((n: any) => n.id === currentNodeId);

        // Fail-safe: If node not found, try finding 'start' type or first node
        if (!currentNode) {
            currentNode = flow.definition.nodes.find((n: any) => n.type === 'start') || flow.definition.nodes[0];
            if (currentNode) {
                // Update session to restart
                await this.updateSessionNode(session.id, currentNode.id);
                session.current_node_id = currentNode.id;
            }
        }

        if (!currentNode) {
            console.error('Node not found execution halted.');
            return;
        }

        // 3. Process User Input (if we are effectively "waiting" at a node)
        // Note: In this simple orchestrator, we assume the previous execution left us at a "wait" state.
        // But for "Input" nodes, we might need to validate.
        // For now, we just proceed to execute the logic of the CURRENT node (or find the next one if the current one was just displayed).

        // **CRITICAL LOGIC CHANGE**: 
        // Typically, `current_node_id` points to the node we *just executed* and are waiting for response.
        // So we should handle the input relative to that node, AND THEN move to the next.

        // Let's implement a simple "Execute Next" logic.
        // If we are at a node that expects input (like Menu or Question), we process the input.
        // Then we find the edge and move to the *next* node.

        // Handling "Start" node special case:
        if (currentNode.type === 'start') {
            await this.transitionToNext(flow, session, currentNode, zapiConfig, message);
            return;
        }

        // Processing Input for the node we are sitting on
        let nextNodeId: string | null = null;
        let handleId: string | undefined = undefined;

        // INTERACTIVE: Match option to handle
        if (currentNode.type === 'interactive') {
            const match = (currentNode.data.options || []).find((opt: any) => opt.label.toLowerCase() === message.toLowerCase());
            if (match) {
                handleId = match.id;
            } else if (this.simulatorMode) {
                // In sim, if no match, maybe user typed something else. 
                // If we strictly enforce buttons, we should ideally re-prompt or just fail to transition.
                // For now, let's allow "dynamic" transition if no handle matched (fallback)? 
                // Or strict? Strict is better for testing flows.
            }
        }

        // CONDITION: Evaluate and choose 'true' or 'false' handle
        if (currentNode.type === 'condition') {
            // Mock Evaluation or Real Variable Check
            // For now, let's assume 'true' for happy path unless we have complex logic
            // Todo: Implement variable store in Session
            const result = true;
            handleId = result ? 'true' : 'false';
        }

        // AFTER processing match/logic, transition.
        await this.transitionToNext(flow, session, currentNode, zapiConfig, message, handleId);
    }

    private async executeNode(node: any, flow: any, session: any, zapiConfig: any) {
        if (this.simulatorMode) {
            console.log(`[Sim] Executing Node: ${node.type}`);
        }

        switch (node.type) {
            case 'start':
                // Auto-advance
                await this.transitionToNext(flow, session, node, zapiConfig, '');
                break;

            case 'message':
                await this.sendOutput('text', node.data.message, session.contact_phone, zapiConfig);
                await this.transitionToNext(flow, session, node, zapiConfig, '');
                break;

            case 'interactive':
                await this.sendOutput('interactive', {
                    title: node.data.title,
                    options: node.data.options,
                    text: node.data.message || node.data.title
                }, session.contact_phone, zapiConfig);
                break;

            case 'ai_orchestrator':
                // Simulate AI processing
                await this.sendOutput('text', `🤖 [IA Pensando...] "${node.data.prompt}"`, session.contact_phone, zapiConfig);
                await this.transitionToNext(flow, session, node, zapiConfig, 'ai-done');
                break;

            case 'condition':
                const { variable, operator, value } = node.data;
                // Evaluate logic
                // Simple variable resolution from session.variables or session context
                const varValue = this.resolveVariable(variable, session);
                let result = false;

                // Normalize for comparison
                const v1 = String(varValue).toLowerCase();
                const v2 = String(value).toLowerCase();

                switch (operator) {
                    case '==': result = v1 == v2; break;
                    case '!=': result = v1 != v2; break;
                    case '>': result = parseFloat(v1) > parseFloat(v2); break;
                    case '<': result = parseFloat(v1) < parseFloat(v2); break;
                    default: result = v1 == v2;
                }

                if (this.simulatorMode) console.log(`[Sim] Condition: ${variable} (${v1}) ${operator} ${value} (${v2}) = ${result}`);

                await this.transitionToNext(flow, session, node, zapiConfig, '', result ? 'true' : 'false');
                break;

            case 'db_query':
                const { table, filterColumn, filterValue } = node.data;

                if (this.simulatorMode) {
                    await this.sendOutput('text', `💾 [Consulta DB] SELECT * FROM ${table} WHERE ${filterColumn} = ${filterValue}`, session.contact_phone, zapiConfig);
                    // Mock result
                    session.variables = { ...session.variables, last_query_result: { id: 123, status: 'mocked' } };
                } else {
                    // Real DB Query
                    try {
                        const solvedValue = this.resolveVariable(filterValue, session) || filterValue;
                        const { data: dbData, error } = await supabase
                            .from(table)
                            .select('*')
                            .eq(filterColumn, solvedValue)
                            .limit(1)
                            .single();

                        if (!error && dbData) {
                            session.variables = { ...session.variables, [`${table}_result`]: dbData };
                            // Also update session in DB
                            await supabase.from('chat_sessions').update({ variables: session.variables }).eq('id', session.id);
                        }
                    } catch (err) {
                        console.error('DB Query Error', err);
                    }
                }
                await this.transitionToNext(flow, session, node, zapiConfig, '');
                break;

            default:
                console.warn('Unknown node type', node.type);
                await this.transitionToNext(flow, session, node, zapiConfig, '');
        }
    }

    // Abstract output sender
    private async sendOutput(type: string, content: any, phone: string, zapiConfig: any) {
        if (this.simulatorMode && this.simulatorHandler) {
            await this.simulatorHandler(type, content);
            return;
        }

        // Real Z-API calls
        if (!zapiConfig) return;

        try {
            if (type === 'text') {
                await zapiService.sendText(zapiConfig.instanceId, zapiConfig.token, zapiConfig.clientToken, phone, content);
            } else if (type === 'interactive') {
                await zapiService.sendOptionList(
                    zapiConfig.instanceId,
                    zapiConfig.token,
                    zapiConfig.clientToken,
                    phone,
                    content.text,
                    content.title,
                    content.options
                );
            }
        } catch (e) {
            console.error('Failed to send output', e);
        }
    }

    private async transitionToNext(flow: any, session: any, currentNode: any, zapiConfig: any, input: string, handleId?: string) {
        // Find edge connected to source
        let edge;
        if (handleId) {
            edge = flow.definition.edges.find((e: any) => e.source === currentNode.id && e.sourceHandle === handleId);
        } else {
            // Default to any edge from this source
            edge = flow.definition.edges.find((e: any) => e.source === currentNode.id);
        }

        // If 'interactive', we might try to find an edge that matches the input text to a handle?
        // Advanced feature. For now simple.

        if (edge) {
            const nextNodeId = edge.target;
            await this.updateSessionNode(session.id, nextNodeId); // Persist state

            // Update in-memory for simulator
            if (this.simulatorMode) this.simulatorState.currentNodeId = nextNodeId;

            // Execute next node
            const nextNode = flow.definition.nodes.find((n: any) => n.id === nextNodeId);
            if (nextNode) {
                // Determine if next node is instantaneous (Message, Start, Condition) or waits (Interactive sometimes?)
                // Actually Message sends and transitions.
                // Interactive sends and WAITS.
                // Start transitions.
                // So we can recursively call execute.
                await this.executeNode(nextNode, flow, session, zapiConfig);
            }
        } else {
            console.log('End of flow reached.');
            if (this.simulatorMode && this.simulatorHandler) {
                await this.simulatorHandler('system', 'Fim do Fluxo');
            }
        }
    }

    // --- Helpers ---

    private async getTenantConfig(tenantId: string) {
        const { data } = await supabase
            .from('tenants')
            .select('zapi_instance_id, zapi_token, zapi_client_token')
            .eq('id', tenantId)
            .single();
        return data;
    }

    private async getSession(tenantId: string, phone: string) {
        const { data } = await supabase
            .from('chat_sessions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('contact_phone', phone)
            .eq('status', 'active')
            .single();
        return data;
    }

    private async startNewSession(tenantId: string, phone: string) {
        // 1. Get Default Flow
        const { data: flow } = await supabase
            .from('bot_flows')
            .select('id, definition')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .limit(1)
            .single();

        if (!flow) return null;

        // 2. Create Session
        const { data } = await supabase
            .from('chat_sessions')
            .insert({
                tenant_id: tenantId,
                contact_phone: phone,
                current_flow_id: flow.id,
                current_node_id: flow.definition.startNodeId,
                status: 'active'
            })
            .select()
            .single();

        return data;
    }

    private async getFlow(flowId: string) {
        const { data } = await supabase.from('bot_flows').select('*').eq('id', flowId).single();
        return data;
    }

    private async updateSessionNode(sessionId: string, nodeId: string) {
        if (this.simulatorMode) return; // Don't write to DB in sim
        await supabase.from('chat_sessions').update({ current_node_id: nodeId }).eq('id', sessionId);
    }

    /**
     * Helper to resolve variables from session or simple strings.
     * Supports dot notation like "session.variables.joy"
     */
    private resolveVariable(path: string, session: any): any {
        if (!path || typeof path !== 'string') return path;

        // Strip {{ }} if present
        const cleanPath = path.replace(/{{|}}/g, '').trim();

        // Check in session variables
        if (session.variables && cleanPath in session.variables) {
            return session.variables[cleanPath];
        }

        // Check strictly nested paths (e.g. variables.joy)
        if (cleanPath.startsWith('variables.')) {
            const key = cleanPath.split('.')[1];
            return session.variables?.[key];
        }

        // Default: return the string itself if no variable found (allows static values)
        // Or if it looks like a number, return number?
        // For now, return path if no match found seems safer for simple comparisons, 
        // BUT if user meant a variable that is undefined, we might want null.
        // Let's assume if it is NOT in variables, it is a literal value unless it starts with variables.
        return path;
    }
}
