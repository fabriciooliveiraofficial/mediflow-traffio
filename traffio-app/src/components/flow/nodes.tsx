import { Handle, Position } from 'reactflow';
import { MessageSquare, MousePointerClick, Bot, GitBranch, Database, Globe, Clock, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const StartNode = ({ selected }: any) => (
    <div className={`w-16 h-16 rounded-full shadow-xl bg-gradient-to-br from-emerald-400 to-emerald-600 border-4 flex items-center justify-center transition-all ${selected ? 'border-brand-primary scale-110 shadow-emerald-200' : 'border-white'}`}>
        <ArrowRight size={28} className="text-white ml-0.5" />
        <Handle type="source" position={Position.Right} className="w-4 h-4 bg-emerald-500 border-2 border-white" />
    </div>
);

export const MessageNode = ({ data, selected }: any) => {
    const { t } = useTranslation('flowBuilder');
    return (
    <div className={`px-5 py-4 shadow-xl rounded-[24px] bg-white border-2 transition-all min-w-[300px] relative ${selected ? 'border-brand-primary ring-8 ring-brand-primary/5' : 'border-ice-200'}`}>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-ice-300 border-2 border-white" />
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-ice-100">
            <div className="p-2 bg-blue-500 rounded-xl text-white shadow-lg shadow-blue-200">
                <MessageSquare size={16} />
            </div>
            <span className="font-black text-graphite-900 text-[10px] uppercase tracking-widest">{t('nodes.message')}</span>
        </div>
        <div className="text-sm text-slate-600 font-medium leading-relaxed italic">
            "{data.message || '...'}"
        </div>
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-blue-500 border-2 border-white" />
    </div>
    );
};

export const AINode = ({ data, selected }: any) => {
    const { t } = useTranslation('flowBuilder');
    return (
    <div className={`px-5 py-4 shadow-2xl rounded-[24px] bg-indigo-50 border-2 border-indigo-400 transition-all min-w-[320px] relative ${selected ? 'border-brand-primary ring-8 ring-brand-primary/10' : 'border-indigo-400'}`}>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-400 border-2 border-white" />
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-indigo-200">
            <div className="p-2 bg-indigo-600 rounded-xl text-white animate-pulse shadow-lg shadow-indigo-300">
                <Bot size={16} />
            </div>
            <span className="font-black text-indigo-900 text-[10px] uppercase tracking-widest">{t('nodes.aiOrchestrator')}</span>
        </div>
        <div className="text-xs text-indigo-700 italic font-bold p-4 rounded-2xl bg-white/60 border border-indigo-100 line-clamp-4 leading-relaxed">
            "{data.ai_config?.system_prompt || data.prompt || t('nodes.aiConfigPlaceholder')}"
        </div>
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-600 border-2 border-white" />
    </div>
    );
};

export const WebhookNode = ({ data, selected }: any) => {
    const { t } = useTranslation('flowBuilder');
    return (
    <div className={`px-5 py-4 shadow-xl rounded-[24px] bg-emerald-50 border-2 border-emerald-400 transition-all min-w-[280px] relative ${selected ? 'border-brand-primary ring-8 ring-brand-primary/10' : 'border-emerald-300'}`}>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-emerald-400 border-2 border-white" />
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-emerald-200">
            <div className="p-2 bg-emerald-600 rounded-xl text-white shadow-lg shadow-emerald-200">
                <Globe size={16} />
            </div>
            <span className="font-black text-emerald-900 text-[10px] uppercase tracking-widest">{t('nodes.webhookApi')}</span>
        </div>
        <div className="text-[10px] font-black text-emerald-700 bg-white/60 p-2 rounded-lg truncate">
            {data.url || t('nodes.urlNotConfigured')}
        </div>
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-emerald-600 border-2 border-white" />
    </div>
    );
};

export const DelayNode = ({ data, selected }: any) => {
    const { t } = useTranslation('flowBuilder');
    return (
    <div className={`px-5 py-4 shadow-xl rounded-[24px] bg-slate-50 border-2 border-slate-400 transition-all min-w-[200px] relative ${selected ? 'border-brand-primary ring-8 ring-brand-primary/10' : 'border-slate-300'}`}>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-400 border-2 border-white" />
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-200 text-slate-800">
            <div className="p-2 bg-slate-700 rounded-xl text-white shadow-lg">
                <Clock size={16} />
            </div>
            <span className="font-black text-[10px] uppercase tracking-widest">{t('nodes.wait')}</span>
        </div>
        <div className="text-sm font-black text-slate-700">
            {data.delay_ms || 5000} ms
        </div>
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-slate-700 border-2 border-white" />
    </div>
    );
};

export const nodeTypes = {
    start: StartNode,
    message: MessageNode,
    ai_orchestrator: AINode,
    webhook: WebhookNode,
    delay: DelayNode,
    interactive: MessageNode, // Temporarily reusing but can expand
    condition: MessageNode,
    db_query: MessageNode,
};
