import 'dotenv/config'; // Ensure environment variables are loaded immediately
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { ChatAgent, BotConfig } from '../../supabase/functions/_shared/chatAgent.ts';
import { aiConfigService } from '../services/aiConfigService.ts';
import { schedulingService } from '../services/agent/schedulingService.ts';

// --- Supabase Client (Node-compatible initialization) ---
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Supabase credentials missing in .env.local');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

// --- Helper Functions ---

// Helper to fetch global AI key
async function getGeminiKey() {
    const { data } = await supabase
        .from('master_config')
        .select('value')
        .eq('key', 'GEMINI_API_KEY')
        .single();
    return data?.value;
}

// Helper for Gemini Fallback (Generative AI)
async function generateAIResponse(apiKey: string, history: { role: string; content: string }[], systemPrompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: history.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                })),
                generationConfig: { temperature: 0.7, maxOutputTokens: 250 }
            })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "Desculpe, não consegui processar sua solicitação agora.";
    } catch (e) {
        console.error('🔴 [GEMINI] API Error:', e);
        return "Tive um problema técnico ao acessar minha inteligência. Tente novamente em instantes.";
    }
}

// Aggregation Buffer: Stores messages for 5s before processing (Simulation Mode)
const aggregationBuffers: Map<string, { timeout: any; messages: string[] }> = new Map();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    if (req.url === '/api/whatsapp-webhook' && req.method === 'POST') {
        let bodyContent = '';
        req.on('data', (chunk: Buffer) => bodyContent += chunk.toString());
        req.on('end', async () => {
            try {
                const payload = JSON.parse(bodyContent);
                const fromP = payload.phone;
                const messageContent = payload.text?.message || payload.message;

                if (!fromP || !messageContent) {
                    res.statusCode = 200;
                    res.end();
                    return;
                }

                console.log(`\n📩 [Z-API] Mensagem de ${fromP}: "${messageContent}"`);

                // 1. Resolve Patient/Tenant Dynamically from DB
                let { data: patientData, error: pError } = await supabase
                    .from("patients")
                    .select("id, tenant_id")
                    .eq("phone", fromP)
                    .maybeSingle();

                if (!patientData) {
                    console.log(`[Z-API] Paciente ${fromP} não encontrado. Buscando tenant para auto-cadastro...`);
                    const { data: leadTenant } = await supabase.from('tenants').select('id').limit(1).single();
                    if (!leadTenant) throw new Error('No tenants available in Database');

                    const { data: newP } = await supabase
                        .from("patients")
                        .insert([{ tenant_id: leadTenant.id, phone: fromP, full_name: payload.pushName || "Usuário Teste" }])
                        .select()
                        .single();
                    patientData = newP;
                }

                if (!patientData) throw new Error('Falha ao resolver ou criar paciente.');

                // 2. Aggregation Logic (5s Window)
                let bufferData = aggregationBuffers.get(fromP);
                if (!bufferData) {
                    console.log(`⏳ [AGGREGATOR] Iniciando janela de 5s para ${fromP}...`);
                    bufferData = {
                        messages: [messageContent],
                        timeout: setTimeout(async () => {
                            const finalBuffer = aggregationBuffers.get(fromP);
                            if (!finalBuffer) return;

                            const combinedMessageText = finalBuffer.messages.join('\n');
                            console.log(`🤖 [AGENT] Processando ${finalBuffer.messages.length} mensagens: "${combinedMessageText}"`);

                            try {
                                const tId = (patientData as any).tenant_id;
                                const pId = (patientData as any).id;

                                // A. Fetch real Bot Config and Gemini Key
                                const [botConf, gemKey] = await Promise.all([
                                    aiConfigService.getBotConfig(tId),
                                    getGeminiKey()
                                ]);

                                // B. Initialize ChatAgent
                                const agentBot = new ChatAgent(pId, tId, schedulingService as any, botConf || undefined);

                                // C. Process Message (Deterministic Path)
                                const agentRes = await agentBot.processMessage(combinedMessageText);

                                // D. Autonomy Check: If no scheduling intent detected, use Gemini
                                const schedulingKeywords = ['especialidade', 'profissionais', 'horário', 'Confirmado', 'Agendar'];
                                const isSchedulingIntent = schedulingKeywords.some(k => agentRes.text.includes(k));

                                let finalReplyMessage = agentRes.text;

                                if (!isSchedulingIntent && gemKey) {
                                    console.log(`✨ [AGENT] Usando IA Generativa (Gemini Fallback)...`);
                                    const sysPrompt = `
                                        ${botConf?.global_instructions || 'Você é o assistente virtual da clínica.'}
                                        Se o usuário quiser agendar, peça para ele digitar "agendar" ou clicar no botão.
                                        Hoje é ${new Date().toLocaleDateString('pt-BR')}.
                                        Personalidade: ${botConf?.personality || 'Formal'}.
                                    `;
                                    finalReplyMessage = await generateAIResponse(gemKey, [{ role: 'user', content: combinedMessageText }], sysPrompt);
                                }

                                console.log(`✅ [AGENT] Resposta: "${finalReplyMessage}"`);
                                console.log(`📡 [Z-API] (Simulação) Resposta enviada para ${fromP}`);

                            } catch (procErr) {
                                console.error('🔴 [AGENT] Erro no processamento:', procErr);
                            } finally {
                                aggregationBuffers.delete(fromP);
                            }
                        }, 5000)
                    };
                    aggregationBuffers.set(fromP, bufferData);
                } else {
                    console.log(`➕ [AGGREGATOR] Adicionando mensagem ao buffer de ${fromP}.`);
                    bufferData.messages.push(messageContent);
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ status: 'buffered' }));

            } catch (err: any) {
                console.error('🔴 [BACKEND] Erro Crítico:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end('Not Found');
    }
});

const SERVICE_PORT = 3000;
server.listen(SERVICE_PORT, () => {
    console.log(`\n🚀 Webhook Simulator (Robust Mode) ON`);
    console.log(`📍 URL: http://localhost:${SERVICE_PORT}/api/whatsapp-webhook`);
    console.log(`🧪 Testando Autonomia: Ativada (Fallback Gemini)`);
});
