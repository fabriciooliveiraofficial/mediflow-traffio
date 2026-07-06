import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import {
    Copy,
    Save,
    Loader2,
    Eye,
    Sliders,
    EyeOff,
    MessageSquare,
    Settings
} from 'lucide-react';

interface MasterTenantLiveChatConfigProps {
    tenantId: string;
    tenantName: string;
}

export const MasterTenantLiveChatConfig: React.FC<MasterTenantLiveChatConfigProps> = ({ tenantId, tenantName }) => {
    const { t } = useTranslation('master');
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [widgetInjected, setWidgetInjected] = useState(false);

    // Live Chat config state
    const [config, setConfig] = useState<any>(null);
    const [formData, setFormData] = useState({
        is_active: true,
        primary_color: '#1152d4',
        welcome_title: 'Iniciar Atendimento',
        welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.'
    });

    useEffect(() => {
        fetchData();
        return () => {
            // Clean up live widget if component unmounts
            cleanupWidget();
        };
    }, [tenantId]);

    const cleanupWidget = () => {
        const script = document.getElementById('test-livechat-script');
        if (script) script.remove();
        const widget = document.querySelector('.traffio-chat-widget');
        if (widget) widget.remove();
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('tenant_livechat_configs')
                .select('*')
                .eq('tenant_id', tenantId)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                setConfig(data);
                setFormData({
                    is_active: data.is_active,
                    primary_color: data.primary_color || '#1152d4',
                    welcome_title: data.welcome_title || 'Iniciar Atendimento',
                    welcome_subtitle: data.welcome_subtitle || 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.'
                });
            } else {
                // If not found, insert default config
                const { data: newConfig, error: insertErr } = await supabase
                    .from('tenant_livechat_configs')
                    .insert({
                        tenant_id: tenantId,
                        is_active: true,
                        primary_color: '#1152d4',
                        welcome_title: 'Iniciar Atendimento',
                        welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.'
                    })
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                if (newConfig) {
                    setConfig(newConfig);
                    setFormData({
                        is_active: newConfig.is_active,
                        primary_color: newConfig.primary_color,
                        welcome_title: newConfig.welcome_title,
                        welcome_subtitle: newConfig.welcome_subtitle
                    });
                }
            }
        } catch (err: any) {
            console.error('Error fetching livechat config:', err);
            showToast('error', t('widgetConfig.toasts.fetchError', { message: err.message }));
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSaving(true);

            const { error } = await supabase
                .from('tenant_livechat_configs')
                .update({
                    is_active: formData.is_active,
                    primary_color: formData.primary_color,
                    welcome_title: formData.welcome_title,
                    welcome_subtitle: formData.welcome_subtitle
                })
                .eq('tenant_id', tenantId);

            if (error) throw error;

            showToast('success', 'Configurações do Live Chat salvas com sucesso!');
            
            // If widget is currently injected, re-inject it to apply new config
            if (widgetInjected) {
                cleanupWidget();
                injectWidget();
            }
            
            fetchData();
        } catch (err: any) {
            showToast('error', 'Erro ao salvar configurações: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const injectWidget = () => {
        const script = document.createElement('script');
        script.src = `${window.location.origin}/livechat-widget.js`;
        script.id = 'test-livechat-script';
        script.setAttribute('data-tenant-id', tenantId);
        script.setAttribute('data-supabase-url', import.meta.env.VITE_SUPABASE_URL || window.location.origin);
        script.setAttribute('data-supabase-anon-key', import.meta.env.VITE_SUPABASE_ANON_KEY || '');
        script.async = true;
        document.body.appendChild(script);
        setWidgetInjected(true);
    };

    const toggleLiveTest = () => {
        if (widgetInjected) {
            cleanupWidget();
            setWidgetInjected(false);
            showToast('success', 'Widget de teste do Live Chat removido.');
        } else {
            injectWidget();
            showToast('success', 'Widget de teste do Live Chat injetado! Clique no balão para abrir.');
        }
    };

    const scriptUrl = `${window.location.origin}/livechat-widget.js`;
    
    const getSnippet = () => {
        return `<!-- Traffio Live Chat Widget -->
<script 
  src="${scriptUrl}" 
  data-tenant-id="${tenantId}" 
  data-supabase-url="${import.meta.env.VITE_SUPABASE_URL || 'https://fyyhxmugxcfqhvoevuwf.supabase.co'}" 
  data-supabase-anon-key="${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}"
  async>
</script>`;
    };

    const copySnippet = () => {
        navigator.clipboard.writeText(getSnippet());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        showToast('success', 'Snippet do Live Chat copiado!');
    };

    if (loading) {
        return (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="animate-spin text-emerald-500" size={24} />
                <p className="text-xs font-semibold">Carregando configurações do Live Chat...</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSave} className="space-y-6 pt-2">
            {/* Live Chat Status & General settings */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                            <MessageSquare className="text-emerald-500" size={16} /> Live Chat Geral
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            Ative ou desative o widget do chat em tempo real e defina as credenciais básicas.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Status do Chat
                        </label>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-all duration-300 border-none ${
                                    formData.is_active ? 'bg-emerald-500' : 'bg-slate-700'
                                }`}
                            >
                                <div
                                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                                        formData.is_active ? 'translate-x-6' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                            <span className="text-xs font-bold text-slate-300">
                                {formData.is_active ? 'Ativo (Exibir widget)' : 'Inativo (Widget ocultado)'}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Cor Primária (Hex)
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={formData.primary_color}
                                onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                className="w-8 h-8 rounded border border-slate-700 bg-transparent p-0 cursor-pointer overflow-hidden"
                            />
                            <input
                                type="text"
                                value={formData.primary_color}
                                onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                placeholder="#1152d4"
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Custom Welcome Message */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                    <Sliders className="text-indigo-400" size={16} /> Personalização do Atendimento
                </h4>
                
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Título do Formulário
                        </label>
                        <input
                            type="text"
                            value={formData.welcome_title}
                            onChange={e => setFormData(prev => ({ ...prev, welcome_title: e.target.value }))}
                            placeholder="Iniciar Atendimento"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Subtítulo do Formulário
                        </label>
                        <textarea
                            value={formData.welcome_subtitle}
                            onChange={e => setFormData(prev => ({ ...prev, welcome_subtitle: e.target.value }))}
                            placeholder="Preencha os campos abaixo para conversar em tempo real com a nossa equipe."
                            rows={3}
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                        />
                    </div>
                </div>
            </div>

            {/* Code Snippet and Live Test */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                            <Settings className="text-amber-500" size={16} /> Instalação e Teste
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            Copie o script abaixo e insira no final da tag &lt;body&gt; do seu site ou landing page.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={toggleLiveTest}
                        className={`px-3 py-1.5 rounded-lg border-none cursor-pointer transition-all flex items-center gap-1.5 text-xs font-bold ${
                            widgetInjected 
                                ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400' 
                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'
                        }`}
                    >
                        {widgetInjected ? <EyeOff size={14} /> : <Eye size={14} />}
                        {widgetInjected ? 'Remover Widget de Teste' : 'Testar nesta Página'}
                    </button>
                </div>

                <div className="space-y-2">
                    <div className="relative">
                        <pre className="bg-[#0A0F1D] border border-[#1E293B] rounded-xl p-4 overflow-x-auto text-[11px] font-mono text-slate-300 leading-relaxed max-w-full select-all col-span-2">
                            {getSnippet()}
                        </pre>
                        <button
                            type="button"
                            onClick={copySnippet}
                            className="absolute top-3 right-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-2 rounded-lg border-none cursor-pointer transition-all flex items-center gap-1 text-[11px] font-semibold"
                        >
                            {copied ? 'Copiado!' : 'Copiar'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex justify-end pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 cursor-pointer border-none disabled:opacity-50"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Salvar Configurações do Live Chat
                </button>
            </div>
        </form>
    );
};
