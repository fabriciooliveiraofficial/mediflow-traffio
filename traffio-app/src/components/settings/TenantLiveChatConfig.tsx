import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import {
    Copy,
    Save,
    Loader2,
    Eye,
    EyeOff,
    MessageSquare,
    Sliders,
    Settings,
    Palette,
    ToggleLeft,
    ToggleRight
} from 'lucide-react';

interface TenantLiveChatConfigProps {
    tenantId: string;
}

export const TenantLiveChatConfig: React.FC<TenantLiveChatConfigProps> = ({ tenantId }) => {
    const { t } = useTranslation('settings');
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [widgetInjected, setWidgetInjected] = useState(false);

    // Live Chat config state
    const [formData, setFormData] = useState({
        is_active: true,
        primary_color: '#1152d4',
        welcome_title: 'Iniciar Atendimento',
        welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
        pill_text: 'Fale conosco',
        header_title: 'Atendimento Online',
        header_subtitle: 'Fale conosco',
        inactivity_timeout_minutes: 30
    });

    useEffect(() => {
        fetchData();
        return () => {
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
                setFormData({
                    is_active: data.is_active,
                    primary_color: data.primary_color || '#1152d4',
                    welcome_title: data.welcome_title || 'Iniciar Atendimento',
                    welcome_subtitle: data.welcome_subtitle || 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
                    pill_text: data.pill_text || 'Fale conosco',
                    header_title: data.header_title || 'Atendimento Online',
                    header_subtitle: data.header_subtitle || 'Fale conosco',
                    inactivity_timeout_minutes: data.inactivity_timeout_minutes ?? 30
                });
            } else {
                // Provision default config if not found
                const { data: newConfig, error: insertErr } = await supabase
                    .from('tenant_livechat_configs')
                    .insert({
                        tenant_id: tenantId,
                        is_active: true,
                        primary_color: '#1152d4',
                        welcome_title: 'Iniciar Atendimento',
                        welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
                        pill_text: 'Fale conosco'
                    })
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                if (newConfig) {
                    setFormData({
                        is_active: newConfig.is_active,
                        primary_color: newConfig.primary_color,
                        welcome_title: newConfig.welcome_title,
                        welcome_subtitle: newConfig.welcome_subtitle,
                        pill_text: newConfig.pill_text,
                        header_title: newConfig.header_title || 'Atendimento Online',
                        header_subtitle: newConfig.header_subtitle || 'Fale conosco',
                        inactivity_timeout_minutes: newConfig.inactivity_timeout_minutes ?? 30
                    });
                }
            }
        } catch (err: any) {
            console.error('Error fetching livechat config:', err);
            showToast('error', t('liveChat.toasts.loadError'));
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
                    welcome_subtitle: formData.welcome_subtitle,
                    pill_text: formData.pill_text,
                    header_title: formData.header_title,
                    header_subtitle: formData.header_subtitle,
                    inactivity_timeout_minutes: Math.max(0, Number(formData.inactivity_timeout_minutes) || 0)
                })
                .eq('tenant_id', tenantId);

            if (error) throw error;

            showToast('success', t('liveChat.toasts.saveSuccess'));

            if (widgetInjected) {
                cleanupWidget();
                injectWidget();
            }
        } catch (err: any) {
            showToast('error', t('liveChat.toasts.saveError', { message: err.message }));
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
            showToast('success', t('liveChat.toasts.testWidgetRemoved'));
        } else {
            injectWidget();
            showToast('success', t('liveChat.toasts.testWidgetInjected'));
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
        showToast('success', t('liveChat.toasts.snippetCopied'));
    };

    if (loading) {
        return (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-graphite-400">
                <Loader2 className="animate-spin text-brand-primary" size={24} />
                <p className="text-xs font-semibold">{t('liveChat.form.loading')}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSave} className="p-8 space-y-8 animate-in fade-in duration-300">
            <div>
                <h3 className="text-xl font-black text-graphite-900">{t('liveChat.form.title')}</h3>
                <p className="text-sm text-graphite-400">
                    {t('liveChat.form.subtitle')}
                </p>
            </div>

            {/* Status & Color Card */}
            <div className="bg-white rounded-2xl p-6 border border-ice-100 shadow-float space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-graphite-700 flex items-center gap-1.5">
                            <MessageSquare className="text-brand-primary" size={16} /> {t('liveChat.form.statusAppearanceHeading')}
                        </h4>
                        <p className="text-[10px] text-graphite-400 mt-0.5">
                            {t('liveChat.form.statusAppearanceHint')}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Switch Status */}
                    <div className="flex items-center justify-between bg-ice-50/50 p-4 rounded-xl">
                        <div className="space-y-0.5">
                            <label className="text-xs font-black uppercase text-graphite-500 tracking-wider">
                                {t('liveChat.form.activateWidget')}
                            </label>
                            <span className="text-[11px] text-graphite-400 block">
                                {formData.is_active ? t('liveChat.form.visibleOnSite') : t('liveChat.form.hiddenFromSite')}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                            className={`p-1 rounded-full transition-colors border-none cursor-pointer ${
                                formData.is_active ? 'text-brand-primary' : 'text-graphite-300'
                            }`}
                        >
                            {formData.is_active ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
                        </button>
                    </div>

                    {/* Color Input */}
                    <div className="flex items-center justify-between bg-ice-50/50 p-4 rounded-xl">
                        <div className="space-y-1 w-full mr-4">
                            <label className="text-xs font-black uppercase text-graphite-500 tracking-wider">
                                {t('liveChat.form.primaryColor')}
                            </label>
                            <input
                                type="text"
                                value={formData.primary_color}
                                onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                placeholder="#1152d4"
                                className="w-full bg-white border border-ice-100 rounded-xl px-3 py-1.5 text-xs text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={formData.primary_color}
                                onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                                className="w-10 h-10 rounded-xl shadow-float cursor-pointer border border-ice-100 overflow-hidden"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Custom Welcome Message */}
            <div className="bg-white rounded-2xl p-6 border border-ice-100 shadow-float space-y-6">
                <h4 className="font-bold text-sm text-graphite-700 flex items-center gap-1.5">
                    <Sliders className="text-brand-primary" size={16} /> {t('liveChat.form.personalizationHeading')}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-graphite-500">
                            {t('liveChat.form.headerTitleLabel')}
                        </label>
                        <input
                            type="text"
                            value={formData.header_title}
                            onChange={e => setFormData(prev => ({ ...prev, header_title: e.target.value }))}
                            placeholder="Atendimento Online"
                            className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-graphite-500">
                            {t('liveChat.form.headerSubtitleLabel')}
                        </label>
                        <input
                            type="text"
                            value={formData.header_subtitle}
                            onChange={e => setFormData(prev => ({ ...prev, header_subtitle: e.target.value }))}
                            placeholder="Fale conosco"
                            className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-graphite-500">
                            {t('liveChat.form.inactivityTimeoutLabel')}
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={formData.inactivity_timeout_minutes}
                            onChange={e => setFormData(prev => ({ ...prev, inactivity_timeout_minutes: Number(e.target.value) }))}
                            placeholder="30"
                            className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors"
                        />
                        <p className="text-[10px] text-graphite-400">{t('liveChat.form.inactivityTimeoutHint')}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-graphite-500">
                                {t('liveChat.form.formTitleLabel')}
                            </label>
                            <input
                                type="text"
                                value={formData.welcome_title}
                                onChange={e => setFormData(prev => ({ ...prev, welcome_title: e.target.value }))}
                                placeholder="Iniciar Atendimento"
                                className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-graphite-500">
                                {t('liveChat.form.pillTextLabel')}
                            </label>
                            <input
                                type="text"
                                value={formData.pill_text}
                                onChange={e => setFormData(prev => ({ ...prev, pill_text: e.target.value }))}
                                placeholder="Fale conosco"
                                className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-graphite-500">
                            {t('liveChat.form.formSubtitleLabel')}
                        </label>
                        <textarea
                            value={formData.welcome_subtitle}
                            onChange={e => setFormData(prev => ({ ...prev, welcome_subtitle: e.target.value }))}
                            placeholder="Preencha os campos abaixo para conversar em tempo real com a nossa equipe."
                            rows={5}
                            className="w-full bg-ice-50 border border-transparent focus:border-brand-primary shadow-float rounded-xl px-3.5 py-2.5 text-sm font-medium text-graphite-700 focus:outline-none transition-colors resize-none"
                        />
                    </div>
                </div>
            </div>

            {/* Code Snippet and Live Test */}
            <div className="bg-white rounded-2xl p-6 border border-ice-100 shadow-float space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <h4 className="font-bold text-sm text-graphite-700 flex items-center gap-1.5">
                            <Settings className="text-brand-primary" size={16} /> {t('liveChat.form.installTestHeading')}
                        </h4>
                        <p className="text-[10px] text-graphite-400 mt-0.5">
                            {t('liveChat.form.installTestHint')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={toggleLiveTest}
                        className={`px-4 py-2 rounded-xl border-none cursor-pointer transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-wide ${
                            widgetInjected
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-500 shadow-float'
                                : 'bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary shadow-float'
                        }`}
                    >
                        {widgetInjected ? <EyeOff size={14} /> : <Eye size={14} />}
                        {widgetInjected ? t('liveChat.form.removeTestWidget') : t('liveChat.form.testOnThisPage')}
                    </button>
                </div>

                <div className="relative">
                    <pre className="bg-ice-50 border border-ice-100 rounded-xl p-4 overflow-x-auto text-[11px] font-mono text-graphite-600 leading-relaxed max-w-full select-all">
                        {getSnippet()}
                    </pre>
                    <button
                        type="button"
                        onClick={copySnippet}
                        className="absolute top-3 right-3 bg-white hover:bg-ice-100 border border-ice-100 text-graphite-500 p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1 text-[11px] font-bold shadow-float"
                    >
                        {copied ? t('liveChat.form.copied') : t('liveChat.form.copy')}
                    </button>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex justify-end pt-2">
                <button
                    type="submit"
                    disabled={saving}
                    className="bg-brand-primary hover:bg-brand-primary/95 text-white font-bold text-xs px-6 py-3 rounded-xl transition-all flex items-center gap-2 cursor-pointer border-none disabled:opacity-50 shadow-float"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {t('liveChat.form.saveButton')}
                </button>
            </div>
        </form>
    );
};
