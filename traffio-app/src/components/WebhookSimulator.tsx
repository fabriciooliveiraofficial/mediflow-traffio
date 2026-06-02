import React, { useState } from 'react';
import { Send, Bot, User, Terminal } from 'lucide-react';
import { FlowOrchestrator } from '../services/flowOrchestrator';
// import { zapiService } from '../services/zapiService';

export const WebhookSimulator = () => {
    const [phone, setPhone] = useState('5511999999999');
    const [message, setMessage] = useState('');
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    // FlowOrchestrator is now stateless regarding Z-API, it fetches config from DB
    // We can't easily mock the internal zapiService calls here without a Dependency Injection container
    // For now, we rely on console logs in FlowOrchestrator or real Z-API calls if configured.

    const orchestrator = new FlowOrchestrator();

    const addLog = (text: string) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${text}`, ...prev]);
    };

    const handleSend = async () => {
        if (!message.trim()) return;
        setLoading(true);
        addLog(`[USER -> BOT] ${message}`);

        try {
            // Hardcoded Tenant for Demo (or fetch from Auth)
            // Ideally we get the current user's tenant
            // For now, we need to fetch it or let user input tenant ID
            // I'll assume we are fetching it from auth inside component wrapper, but here I can just use a placeholder or try to fetch

            const { data: { user } } = await import('../lib/supabase').then(m => m.supabase.auth.getUser());
            const { data: tenant } = await import('../lib/supabase').then(m => m.supabase.from('tenants').select('id').eq('owner_id', user?.id).single());

            if (tenant) {
                await orchestrator.handleMessage(tenant.id, phone, message);
            } else {
                addLog('Error: Tenant not found via Auth');
            }

        } catch (err: any) {
            addLog(`Error: ${err.message}`);
        } finally {
            setLoading(false);
            setMessage('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-ice-100 overflow-hidden">
            <div className="bg-graphite-900 text-white p-4 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Terminal size={18} className="text-brand-primary" />
                    <span className="font-bold">Simulador de Webhook (WhatsApp)</span>
                </div>
                <div className="text-xs text-graphite-400">
                    Ambiente de Teste
                </div>
            </div>

            <div className="flex-1 p-4 bg-ice-50 overflow-y-auto font-mono text-xs space-y-2">
                {logs.length === 0 && <p className="text-center text-graphite-400 mt-10">Aguardando interação...</p>}
                {logs.map((log, i) => (
                    <div key={i} className={`p-2 rounded border-l-2 ${log.includes('[USER') ? 'bg-white border-blue-400' :
                        log.includes('[BOT') ? 'bg-emerald-50 border-emerald-400' : 'bg-gray-100 border-gray-400'
                        }`}>
                        {log}
                    </div>
                ))}
            </div>

            <div className="p-4 bg-white border-t border-ice-100">
                <div className="flex gap-2 mb-2">
                    <input
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        className="w-1/3 bg-ice-50 border border-ice-200 rounded-lg px-3 py-2 text-xs font-bold"
                        placeholder="Telefone (55...)"
                    />
                </div>
                <div className="flex gap-2">
                    <input
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        className="flex-1 bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand-primary"
                        placeholder="Digite uma mensagem como se fosse o usuário..."
                    />
                    <button
                        onClick={handleSend}
                        disabled={loading}
                        className="bg-brand-primary text-white p-3 rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 border-none cursor-pointer"
                    >
                        {loading ? <Bot className="animate-pulse" size={20} /> : <Send size={20} />}
                    </button>
                </div>
            </div>
        </div>
    );
};
