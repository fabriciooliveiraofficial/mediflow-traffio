import { FlowOrchestrator } from './src/services/flowOrchestrator';
import { ZApiService } from './src/services/zapiService';
import { supabase } from './src/lib/supabase';

// Mock ZAPI
class MockZApi extends ZApiService {
    constructor() { super({ instanceId: 'mock', token: 'mock', clientToken: 'mock' }); }
    async sendText(phone: string, message: string) { console.log(`[MOCK ZAPI] Text to ${phone}: ${message}`); return {}; }
    async sendButtonList(phone: string, message: string, buttons: any[]) {
        console.log(`[MOCK ZAPI] Buttons to ${phone}: ${message}`, buttons);
        return {};
    }
}

async function runTest() {
    console.log('--- STARTING FLOW TEST ---');
    const tenantId = 'd290f1ee-6c54-4b01-90e6-d701748f0851'; // Use a real tenant ID from your DB if possible or Insert one
    const phone = '5511999990000';

    // 1. Setup Flow (INSERT INTO DB for test)
    // Definition: Start -> Message("Ola") -> Menu("1. Agendar") -> Message("Agendando...")
    const flowDefinition = {
        startNodeId: 'node-start',
        nodes: [
            { id: 'node-start', type: 'start' },
            { id: 'node-welcome', type: 'message', data: { message: 'Olá! Bem-vindo.' } },
            {
                id: 'node-menu', type: 'menu', data: {
                    title: 'Menu Principal',
                    message: 'Escolha uma opção:',
                    options: [{ id: 'opt-1', label: 'Agendar' }, { id: 'opt-2', label: 'Ajuda' }]
                }
            },
            { id: 'node-booking', type: 'message', data: { message: 'Ok, vamos agendar!' } },
            { id: 'node-help', type: 'message', data: { message: 'Fale com suporte.' } }
        ],
        edges: [
            { source: 'node-start', target: 'node-welcome' },
            { source: 'node-welcome', target: 'node-menu' },
            { source: 'node-menu', sourceHandle: 'opt-1', target: 'node-booking' },
            { source: 'node-menu', sourceHandle: 'opt-2', target: 'node-help' }
        ]
    };

    console.log('1. Creating Mock Flow in DB...');
    const { data: flow, error } = await supabase.from('bot_flows').insert({
        tenant_id: tenantId,
        name: 'Test Flow ' + Date.now(),
        definition: flowDefinition,
        is_active: true
    }).select().single();

    if (error) { console.error('Error creating flow', error); return; }
    console.log('Flow Created:', flow.id);

    // 2. Initialize Orchestrator
    const orchestrator = new FlowOrchestrator(new MockZApi());

    // 3. User says "Oi" (Should trigger Start -> Welcome -> Menu)
    console.log('\n--- SIMULATION 1: User says "Oi" ---');
    await orchestrator.handleMessage(tenantId, phone, 'Oi');

    // 4. User says "Agendar" (Should trigger Menu -> Booking)
    console.log('\n--- SIMULATION 2: User says "Agendar" ---');
    await orchestrator.handleMessage(tenantId, phone, 'Agendar');

    // 5. Cleanup
    console.log('\n--- CLEANUP ---');
    await supabase.from('bot_flows').delete().eq('id', flow.id);
    await supabase.from('chat_sessions').delete().eq('contact_phone', phone);
    console.log('Done.');
}

runTest();
