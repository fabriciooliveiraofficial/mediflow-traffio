import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import {
    Key,
    Copy,
    Check,
    RotateCw,
    Save,
    Loader2,
    Globe,
    Palette,
    Eye,
    AlertCircle,
    Sliders,
    EyeOff,
    CheckCircle2
} from 'lucide-react';

interface MasterTenantWidgetConfigProps {
    tenantId: string;
    tenantName: string;
}

export const MasterTenantWidgetConfig: React.FC<MasterTenantWidgetConfigProps> = ({ tenantId, tenantName }) => {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [generatingKey, setGeneratingKey] = useState(false);
    const [copied, setCopied] = useState(false);
    const [widgetInjected, setWidgetInjected] = useState(false);

    // Tenant localization state
    const [localeData, setLocaleData] = useState({
        locale: 'pt-BR',
        country: 'BR',
        timezone: 'America/Sao_Paulo'
    });

    // Widget config state
    const [config, setConfig] = useState<any>(null);
    const [formData, setFormData] = useState({
        allowed_domains: '',
        primary_color: '#0E7C7B',
        fab_label: 'Agendar',
        fab_style: 'soft' as 'solid' | 'soft' | 'outline',
        fab_position: 'bottom-right' as 'bottom-right' | 'bottom-left',
        fab_delay_ms: 0,
        meta_pixel_id: '',
        google_ads_id: '',
        google_conversion_label: '',
        success_virtual_path: '/agendamento-confirmado',
        is_active: true
    });

    useEffect(() => {
        fetchData();
        return () => {
            // Clean up live widget if component unmounts
            const el = document.getElementById('test-booking-widget');
            if (el) el.remove();
        };
    }, [tenantId]);

    const fetchData = async () => {
        try {
            setLoading(true);
            // 1. Fetch tenant locale data
            const { data: tenant, error: tenantErr } = await supabase
                .from('tenants')
                .select('locale, country, timezone')
                .eq('id', tenantId)
                .single();
            if (tenantErr) throw tenantErr;
            if (tenant) {
                setLocaleData({
                    locale: tenant.locale || 'pt-BR',
                    country: tenant.country || 'BR',
                    timezone: tenant.timezone || 'America/Sao_Paulo'
                });
            }

            // 2. Fetch widget configs
            const { data: keysData, error: keysErr } = await supabase
                .from('tenant_public_keys')
                .select('*')
                .eq('tenant_id', tenantId)
                .maybeSingle();
            if (keysErr) throw keysErr;
            setConfig(keysData);

            if (keysData) {
                setFormData({
                    allowed_domains: (keysData.allowed_domains || []).join(', '),
                    primary_color: keysData.primary_color || '#0E7C7B',
                    fab_label: keysData.fab_label || 'Agendar',
                    fab_style: keysData.fab_style || 'soft',
                    fab_position: keysData.fab_position || 'bottom-right',
                    fab_delay_ms: keysData.fab_delay_ms || 0,
                    meta_pixel_id: keysData.meta_pixel_id || '',
                    google_ads_id: keysData.google_ads_id || '',
                    google_conversion_label: keysData.google_conversion_label || '',
                    success_virtual_path: keysData.success_virtual_path || '/agendamento-confirmado',
                    is_active: keysData.is_active
                });
            }
        } catch (err: any) {
            console.error('Error fetching widget data:', err);
            showToast('error', 'Erro ao carregar dados do widget: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleProvisionKey = async () => {
        try {
            setGeneratingKey(true);
            const { data, error } = await supabase
                .rpc('provision_tenant_public_key', { p_tenant_id: tenantId });
            if (error) throw error;
            showToast('success', 'Chave pública gerada e Widget habilitado!');
            fetchData();
        } catch (err: any) {
            showToast('error', 'Erro ao provisionar chave: ' + err.message);
        } finally {
            setGeneratingKey(false);
        }
    };

    const handleRotateKey = async () => {
        if (!window.confirm('CUIDADO: Rotacionar a chave tornará o widget antigo nas landings inoperante até que o snippet seja atualizado. Deseja continuar?')) return;
        try {
            setGeneratingKey(true);
            const newKey = 'pk_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
            const { error } = await supabase
                .from('tenant_public_keys')
                .update({ public_key: newKey })
                .eq('tenant_id', tenantId);
            if (error) throw error;
            showToast('success', 'Nova chave pública gerada com sucesso!');
            fetchData();
        } catch (err: any) {
            showToast('error', 'Erro ao rotacionar chave: ' + err.message);
        } finally {
            setGeneratingKey(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSaving(true);
            // 1. Update tenants table (localization)
            const { error: tenantErr } = await supabase
                .from('tenants')
                .update(localeData)
                .eq('id', tenantId);
            if (tenantErr) throw tenantErr;

            // 2. Update widget details
            const domains = formData.allowed_domains
                .split(',')
                .map(d => d.trim())
                .filter(Boolean);

            const { error: keysErr } = await supabase
                .from('tenant_public_keys')
                .update({
                    allowed_domains: domains,
                    primary_color: formData.primary_color,
                    fab_label: formData.fab_label,
                    fab_style: formData.fab_style,
                    fab_position: formData.fab_position,
                    fab_delay_ms: Number(formData.fab_delay_ms),
                    meta_pixel_id: formData.meta_pixel_id,
                    google_ads_id: formData.google_ads_id,
                    google_conversion_label: formData.google_conversion_label,
                    success_virtual_path: formData.success_virtual_path,
                    is_active: formData.is_active
                })
                .eq('tenant_id', tenantId);
            if (keysErr) throw keysErr;

            showToast('success', 'Configurações de widget salvas com sucesso!');
            fetchData();
        } catch (err: any) {
            showToast('error', 'Erro ao salvar configurações: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const toggleLiveTest = () => {
        if (!config?.public_key) return;

        if (widgetInjected) {
            const el = document.getElementById('test-booking-widget');
            if (el) el.remove();
            setWidgetInjected(false);
            showToast('success', 'Widget de teste removido.');
        } else {
            // Check script loading
            if (!document.querySelector('script[data-widget-core]')) {
                const script = document.createElement('script');
                script.src = `${window.location.origin}/widget/v1/widget.js`;
                script.async = true;
                script.setAttribute('data-widget-core', 'true');
                document.body.appendChild(script);
            }

            const el = document.createElement('mediflow-booking');
            el.setAttribute('data-key', config.public_key);
            el.setAttribute('id', 'test-booking-widget');
            document.body.appendChild(el);
            setWidgetInjected(true);
            showToast('success', 'Widget de teste injetado! Clique no botão flutuante para interagir.');
        }
    };

    const scriptUrl = `${window.location.origin}/widget/v1/widget.js`;
    const snippet = `<!-- Mediflow Booking Widget -->\n<script src="${scriptUrl}" async></script>\n<mediflow-booking data-key="${config?.public_key || ''}"></mediflow-booking>`;

    const copySnippet = () => {
        navigator.clipboard.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        showToast('success', 'Snippet copiado!');
    };

    if (loading) {
        return (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="animate-spin text-emerald-500" size={24} />
                <p className="text-xs font-semibold">Carregando configurações do widget...</p>
            </div>
        );
    }

    if (!config) {
        return (
            <div className="border border-dashed border-[#1E293B] rounded-2xl p-8 text-center space-y-4">
                <Sliders className="mx-auto text-slate-600" size={32} />
                <h4 className="font-bold text-white text-sm">Widget de Agendamento Inativo</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Esta clínica ainda não possui uma chave pública ativa para incorporar o agendamento em páginas externas.
                </p>
                <button
                    onClick={handleProvisionKey}
                    disabled={generatingKey}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 border-none"
                >
                    {generatingKey ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                    Gerar Chave e Habilitar Widget
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSave} className="space-y-6 pt-2">
            {/* API Credentials */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                            <Key className="text-emerald-500" size={16} /> Credenciais da API Pública
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            Identificador único público (Stripe-like) usado na tag HTML do widget.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleRotateKey}
                            disabled={generatingKey}
                            title="Rotacionar Chave Pública"
                            className="bg-[#1E293B] hover:bg-[#2D3B55] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border-none cursor-pointer transition-all flex items-center gap-1 text-[11px] font-bold disabled:opacity-50"
                        >
                            {generatingKey ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                            Rotacionar Chave
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-[#0A0F1D] border border-[#1E293B] rounded-xl px-3.5 py-2.5 font-mono text-xs text-emerald-400 select-all justify-between">
                    <span className="truncate pr-4">{config.public_key}</span>
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard.writeText(config.public_key);
                            showToast('success', 'Chave copiada!');
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-1.5 rounded border-none cursor-pointer transition-all shrink-0"
                    >
                        <Copy size={12} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Status do Widget
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
                                {formData.is_active ? 'Ativo (Permite agendamentos)' : 'Inativo (Bloqueado)'}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Domínios Autorizados (CORS)
                        </label>
                        <input
                            type="text"
                            value={formData.allowed_domains}
                            onChange={e => setFormData(prev => ({ ...prev, allowed_domains: e.target.value }))}
                            placeholder="ex: clinica.com, landing.saude.br"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                        />
                        <p className="text-[9px] text-slate-500">
                            Separe múltiplos domínios por vírgula. Evita que a chave seja roubada e usada em outros sites.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Localização & i18n */}
                <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                    <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <Globe className="text-indigo-400" size={16} /> Localização & Idioma
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Idioma (Locale)</label>
                            <select
                                value={localeData.locale}
                                onChange={e => setLocaleData(prev => ({ ...prev, locale: e.target.value }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="pt-BR">Português (pt-BR)</option>
                                <option value="en-US">English (en-US)</option>
                                <option value="en-NZ">English (en-NZ)</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">País</label>
                            <select
                                value={localeData.country}
                                onChange={e => setLocaleData(prev => ({ ...prev, country: e.target.value }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="BR">Brasil</option>
                                <option value="US">Estados Unidos</option>
                                <option value="NZ">Nova Zelândia</option>
                            </select>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Fuso Horário (Timezone)</label>
                        <select
                            value={localeData.timezone}
                            onChange={e => setLocaleData(prev => ({ ...prev, timezone: e.target.value }))}
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                            <option value="America/Sao_Paulo">América/São Paulo (-03:00)</option>
                            <option value="America/New_York">América/Nova York (EST/EDT)</option>
                            <option value="America/Chicago">América/Chicago (CST/CDT)</option>
                            <option value="America/Denver">América/Denver (MST/MDT)</option>
                            <option value="America/Los_Angeles">América/Los Angeles (PST/PDT)</option>
                            <option value="Pacific/Auckland">Pacífico/Auckland (NZST/NZDT)</option>
                        </select>
                    </div>
                </div>

                {/* Tema e Customização do FAB */}
                <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                    <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <Palette className="text-amber-400" size={16} /> Aparência & Botão (FAB)
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Cor Primária (Hex)</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={formData.primary_color}
                                    onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                    className="bg-transparent border-none w-8 h-8 rounded cursor-pointer shrink-0"
                                />
                                <input
                                    type="text"
                                    value={formData.primary_color}
                                    onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Texto do Botão</label>
                            <input
                                type="text"
                                value={formData.fab_label}
                                onChange={e => setFormData(prev => ({ ...prev, fab_label: e.target.value }))}
                                placeholder="Agendar"
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Estilo FAB</label>
                            <select
                                value={formData.fab_style}
                                onChange={e => setFormData(prev => ({ ...prev, fab_style: e.target.value as any }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            >
                                <option value="solid">Sólido</option>
                                <option value="soft">Soft</option>
                                <option value="outline">Contorno</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Posição</label>
                            <select
                                value={formData.fab_position}
                                onChange={e => setFormData(prev => ({ ...prev, fab_position: e.target.value as any }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            >
                                <option value="bottom-right">Canto Direito</option>
                                <option value="bottom-left">Canto Esquerdo</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Atraso (MS)</label>
                            <input
                                type="number"
                                value={formData.fab_delay_ms}
                                onChange={e => setFormData(prev => ({ ...prev, fab_delay_ms: Number(e.target.value) }))}
                                min="0"
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Rastreamento de Marketing */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                    <Sliders className="text-emerald-400" size={16} /> Rastreamento de Conversões (Meta & Google)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Meta Pixel ID</label>
                        <input
                            type="text"
                            value={formData.meta_pixel_id}
                            onChange={e => setFormData(prev => ({ ...prev, meta_pixel_id: e.target.value }))}
                            placeholder="ex: 1234567890"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Google Ads ID</label>
                        <input
                            type="text"
                            value={formData.google_ads_id}
                            onChange={e => setFormData(prev => ({ ...prev, google_ads_id: e.target.value }))}
                            placeholder="ex: AW-123456789"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Google Conversion Label</label>
                        <input
                            type="text"
                            value={formData.google_conversion_label}
                            onChange={e => setFormData(prev => ({ ...prev, google_conversion_label: e.target.value }))}
                            placeholder="ex: abCD12efgh34"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                        Caminho da Rota Fantasma de Sucesso <AlertCircle size={10} className="text-slate-500" title="Usado no Virtual Pageview" />
                    </label>
                    <input
                        type="text"
                        value={formData.success_virtual_path}
                        onChange={e => setFormData(prev => ({ ...prev, success_virtual_path: e.target.value }))}
                        placeholder="/agendamento-confirmado"
                        className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                    />
                    <p className="text-[9px] text-slate-500">
                        O widget empurra este caminho fictício via `pushState` e gera um `page_view` no GTM quando a consulta é confirmada, facilitando trackings baseados em URLs.
                    </p>
                </div>
            </div>

            {/* Snippet HTML e Teste ao Vivo */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                            <Eye className="text-sky-400" size={16} /> Instalação e Teste
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            Copie o código abaixo e cole no HTML da landing page (Hostinger/WordPress/WP Bloco).
                        </p>
                    </div>
                    <div>
                        <button
                            type="button"
                            onClick={toggleLiveTest}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border-none transition-all ${
                                widgetInjected
                                    ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            }`}
                        >
                            {widgetInjected ? <EyeOff size={14} /> : <Eye size={14} />}
                            {widgetInjected ? 'Remover Widget de Teste' : 'Testar nesta Página'}
                        </button>
                    </div>
                </div>

                <div className="relative">
                    <pre className="bg-[#0A0F1D] border border-[#1E293B] rounded-xl p-4 overflow-x-auto text-[11px] font-mono text-slate-300 select-all leading-relaxed">
                        {snippet}
                    </pre>
                    <button
                        type="button"
                        onClick={copySnippet}
                        className="absolute right-4 top-4 bg-[#1E293B] hover:bg-[#2D3B55] text-slate-400 hover:text-white px-3 py-2 rounded-lg border-none cursor-pointer transition-all flex items-center gap-1 text-[10px] font-bold"
                    >
                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {copied ? 'Copiado!' : 'Copiar Código'}
                    </button>
                </div>

                {/* Mock Visual Preview of FAB */}
                <div className="border border-[#1E293B] rounded-xl p-4 bg-[#0A0F1D] flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Pré-visualização do FAB</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">Estilo e contraste simulado do botão flutuante.</p>
                    </div>
                    <div
                        className="h-14 w-40 rounded-xl flex items-center justify-center relative cursor-not-allowed shadow-inner"
                        style={{
                            background: '#10172A',
                            border: '1px solid #1E293B'
                        }}
                    >
                        <button
                            type="button"
                            disabled
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full font-bold text-xs shadow-md border-none cursor-not-allowed"
                            style={{
                                backgroundColor: formData.fab_style === 'solid' ? formData.primary_color : '#ffffff',
                                color: formData.fab_style === 'solid' ? (config.primary_color ? getContrastText(formData.primary_color) : '#ffffff') : formData.primary_color,
                                border: formData.fab_style === 'outline' ? `2px solid ${formData.primary_color}` : '2px solid transparent'
                            }}
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                            {formData.fab_label}
                        </button>
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[#1E293B]">
                <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-600 transition-all border-none cursor-pointer disabled:opacity-50 text-sm shadow-lg shadow-emerald-500/10"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Salvar Configurações do Widget
                </button>
            </div>
        </form>
    );
};

// Auxiliary contrast luminance finder
function getContrastText(hex: string) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex || '0E7C7B', 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    
    // Calculate relative luminance
    const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    
    // Choose white or dark grey text
    return L > 0.4 ? '#0b1220' : '#ffffff';
}
