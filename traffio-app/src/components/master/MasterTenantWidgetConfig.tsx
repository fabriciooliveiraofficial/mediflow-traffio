import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation('master');
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
        fab_label: t('widgetConfig.defaults.fabLabel'),
        fab_style: 'soft' as 'solid' | 'soft' | 'outline',
        fab_position: 'bottom-right' as 'bottom-right' | 'bottom-left',
        fab_delay_ms: 0,
        meta_pixel_id: '',
        google_ads_id: '',
        google_conversion_label: '',
        success_virtual_path: '/agendamento-confirmado',
        is_active: true,
        privacy_policy_url: ''
    });

    const [doctors, setDoctors] = useState<any[]>([]);
    const [specialties, setSpecialties] = useState<string[]>([]);
    const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState('');
    const [selectedDoctorFilter, setSelectedDoctorFilter] = useState('');

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

            // 3. Fetch active doctors to extract distinct specialties for custom snippet builder
            const { data: docsData, error: docsErr } = await supabase
                .from('doctors')
                .select('id, full_name, specialty')
                .eq('tenant_id', tenantId)
                .eq('is_active', true);
            if (docsErr) throw docsErr;
            if (docsData) {
                setDoctors(docsData);
                const uniqueSpecs = Array.from(new Set(docsData.map(d => d.specialty).filter(Boolean))) as string[];
                setSpecialties(uniqueSpecs);
            }

            if (keysData) {
                setFormData({
                    allowed_domains: (keysData.allowed_domains || []).join(', '),
                    primary_color: keysData.primary_color || '#0E7C7B',
                    fab_label: keysData.fab_label || t('widgetConfig.defaults.fabLabel'),
                    fab_style: keysData.fab_style || 'soft',
                    fab_position: keysData.fab_position || 'bottom-right',
                    fab_delay_ms: keysData.fab_delay_ms || 0,
                    meta_pixel_id: keysData.meta_pixel_id || '',
                    google_ads_id: keysData.google_ads_id || '',
                    google_conversion_label: keysData.google_conversion_label || '',
                    success_virtual_path: keysData.success_virtual_path || '/agendamento-confirmado',
                    is_active: keysData.is_active,
                    privacy_policy_url: keysData.privacy_policy_url || ''
                });
            }
        } catch (err: any) {
            console.error('Error fetching widget data:', err);
            showToast('error', t('widgetConfig.toasts.fetchError', { message: err.message }));
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
            showToast('success', t('widgetConfig.toasts.provisionSuccess'));
            fetchData();
        } catch (err: any) {
            showToast('error', t('widgetConfig.toasts.provisionError', { message: err.message }));
        } finally {
            setGeneratingKey(false);
        }
    };

    const handleRotateKey = async () => {
        if (!window.confirm(t('widgetConfig.toasts.rotateConfirm'))) return;
        try {
            setGeneratingKey(true);
            const newKey = 'pk_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
            const { error } = await supabase
                .from('tenant_public_keys')
                .update({ public_key: newKey })
                .eq('tenant_id', tenantId);
            if (error) throw error;
            showToast('success', t('widgetConfig.toasts.rotateSuccess'));
            fetchData();
        } catch (err: any) {
            showToast('error', t('widgetConfig.toasts.rotateError', { message: err.message }));
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
                    is_active: formData.is_active,
                    privacy_policy_url: formData.privacy_policy_url
                })
                .eq('tenant_id', tenantId);
            if (keysErr) throw keysErr;

            showToast('success', t('widgetConfig.toasts.saveSuccess'));
            fetchData();
        } catch (err: any) {
            showToast('error', t('widgetConfig.toasts.saveError', { message: err.message }));
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
            showToast('success', t('widgetConfig.toasts.testRemoved'));
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
            if (selectedSpecialtyFilter) {
                el.setAttribute('data-specialty', selectedSpecialtyFilter);
            }
            if (selectedDoctorFilter) {
                el.setAttribute('data-doctor', selectedDoctorFilter);
            }
            el.setAttribute('id', 'test-booking-widget');
            document.body.appendChild(el);
            setWidgetInjected(true);
            showToast('success', t('widgetConfig.toasts.testInjected'));
        }
    };

    const scriptUrl = `${window.location.origin}/widget/v1/widget.js`;
    
    const getSnippet = () => {
        let attrs = `data-key="${config?.public_key || ''}"`;
        if (selectedSpecialtyFilter) {
            attrs += ` data-specialty="${selectedSpecialtyFilter}"`;
        }
        if (selectedDoctorFilter) {
            attrs += ` data-doctor="${selectedDoctorFilter}"`;
        }
        return `<!-- Mediflow Booking Widget -->\n<script src="${scriptUrl}" async></script>\n<mediflow-booking ${attrs}></mediflow-booking>`;
    };

    const snippet = getSnippet();

    const copySnippet = () => {
        navigator.clipboard.writeText(getSnippet());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        showToast('success', t('widgetConfig.toasts.snippetCopied'));
    };

    if (loading) {
        return (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="animate-spin text-emerald-500" size={24} />
                <p className="text-xs font-semibold">{t('widgetConfig.loading')}</p>
            </div>
        );
    }

    if (!config) {
        return (
            <div className="border border-dashed border-[#1E293B] rounded-2xl p-8 text-center space-y-4">
                <Sliders className="mx-auto text-slate-600" size={32} />
                <h4 className="font-bold text-white text-sm">{t('widgetConfig.inactiveState.title')}</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {t('widgetConfig.inactiveState.description')}
                </p>
                <button
                    onClick={handleProvisionKey}
                    disabled={generatingKey}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 border-none"
                >
                    {generatingKey ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                    {t('widgetConfig.inactiveState.generateButton')}
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
                            <Key className="text-emerald-500" size={16} /> {t('widgetConfig.apiCredentials.title')}
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            {t('widgetConfig.apiCredentials.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleRotateKey}
                            disabled={generatingKey}
                            title={t('widgetConfig.apiCredentials.rotateKeyTitle')}
                            className="bg-[#1E293B] hover:bg-[#2D3B55] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border-none cursor-pointer transition-all flex items-center gap-1 text-[11px] font-bold disabled:opacity-50"
                        >
                            {generatingKey ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                            {t('widgetConfig.apiCredentials.rotateKeyButton')}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-[#0A0F1D] border border-[#1E293B] rounded-xl px-3.5 py-2.5 font-mono text-xs text-emerald-400 select-all justify-between">
                    <span className="truncate pr-4">{config.public_key}</span>
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard.writeText(config.public_key);
                            showToast('success', t('widgetConfig.toasts.keyCopied'));
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-1.5 rounded border-none cursor-pointer transition-all shrink-0"
                    >
                        <Copy size={12} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            {t('widgetConfig.apiCredentials.statusLabel')}
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
                                {formData.is_active ? t('widgetConfig.apiCredentials.statusActive') : t('widgetConfig.apiCredentials.statusInactive')}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            {t('widgetConfig.apiCredentials.domainsLabel')}
                        </label>
                        <input
                            type="text"
                            value={formData.allowed_domains}
                            onChange={e => setFormData(prev => ({ ...prev, allowed_domains: e.target.value }))}
                            placeholder={t('widgetConfig.apiCredentials.domainsPlaceholder')}
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                        />
                        <p className="text-[9px] text-slate-500">
                            {t('widgetConfig.apiCredentials.domainsHint')}
                        </p>
                    </div>

                    <div className="space-y-1 md:col-span-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            {t('widgetConfig.apiCredentials.privacyUrlLabel')}
                        </label>
                        <input
                            type="url"
                            value={formData.privacy_policy_url}
                            onChange={e => setFormData(prev => ({ ...prev, privacy_policy_url: e.target.value }))}
                            placeholder={t('widgetConfig.apiCredentials.privacyUrlPlaceholder')}
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                        />
                        <p className="text-[9px] text-slate-500">
                            {t('widgetConfig.apiCredentials.privacyUrlHint')}
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Localização & i18n */}
                <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                    <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <Globe className="text-indigo-400" size={16} /> {t('widgetConfig.localization.title')}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.localization.localeLabel')}</label>
                            <select
                                value={localeData.locale}
                                onChange={e => setLocaleData(prev => ({ ...prev, locale: e.target.value }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="pt-BR">{t('widgetConfig.localization.localeOptions.ptBR')}</option>
                                <option value="en-US">{t('widgetConfig.localization.localeOptions.enUS')}</option>
                                <option value="en-NZ">{t('widgetConfig.localization.localeOptions.enNZ')}</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.localization.countryLabel')}</label>
                            <select
                                value={localeData.country}
                                onChange={e => setLocaleData(prev => ({ ...prev, country: e.target.value }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="BR">{t('widgetConfig.localization.countryOptions.br')}</option>
                                <option value="US">{t('widgetConfig.localization.countryOptions.us')}</option>
                                <option value="NZ">{t('widgetConfig.localization.countryOptions.nz')}</option>
                            </select>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.localization.timezoneLabel')}</label>
                        <select
                            value={localeData.timezone}
                            onChange={e => setLocaleData(prev => ({ ...prev, timezone: e.target.value }))}
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                            <option value="America/Sao_Paulo">{t('widgetConfig.localization.timezoneOptions.saoPaulo')}</option>
                            <option value="America/New_York">{t('widgetConfig.localization.timezoneOptions.newYork')}</option>
                            <option value="America/Chicago">{t('widgetConfig.localization.timezoneOptions.chicago')}</option>
                            <option value="America/Denver">{t('widgetConfig.localization.timezoneOptions.denver')}</option>
                            <option value="America/Los_Angeles">{t('widgetConfig.localization.timezoneOptions.losAngeles')}</option>
                            <option value="Pacific/Auckland">{t('widgetConfig.localization.timezoneOptions.auckland')}</option>
                        </select>
                    </div>
                </div>

                {/* Tema e Customização do FAB */}
                <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                    <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <Palette className="text-amber-400" size={16} /> {t('widgetConfig.appearance.title')}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.appearance.primaryColorLabel')}</label>
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
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.appearance.buttonTextLabel')}</label>
                            <input
                                type="text"
                                value={formData.fab_label}
                                onChange={e => setFormData(prev => ({ ...prev, fab_label: e.target.value }))}
                                placeholder={t('widgetConfig.defaults.fabLabel')}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.appearance.fabStyleLabel')}</label>
                            <select
                                value={formData.fab_style}
                                onChange={e => setFormData(prev => ({ ...prev, fab_style: e.target.value as any }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            >
                                <option value="solid">{t('widgetConfig.appearance.fabStyleOptions.solid')}</option>
                                <option value="soft">{t('widgetConfig.appearance.fabStyleOptions.soft')}</option>
                                <option value="outline">{t('widgetConfig.appearance.fabStyleOptions.outline')}</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.appearance.positionLabel')}</label>
                            <select
                                value={formData.fab_position}
                                onChange={e => setFormData(prev => ({ ...prev, fab_position: e.target.value as any }))}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                            >
                                <option value="bottom-right">{t('widgetConfig.appearance.positionOptions.right')}</option>
                                <option value="bottom-left">{t('widgetConfig.appearance.positionOptions.left')}</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.appearance.delayLabel')}</label>
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
                    <Sliders className="text-emerald-400" size={16} /> {t('widgetConfig.tracking.title')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.tracking.metaPixelLabel')}</label>
                        <input
                            type="text"
                            value={formData.meta_pixel_id}
                            onChange={e => setFormData(prev => ({ ...prev, meta_pixel_id: e.target.value }))}
                            placeholder="ex: 1234567890"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.tracking.googleAdsLabel')}</label>
                        <input
                            type="text"
                            value={formData.google_ads_id}
                            onChange={e => setFormData(prev => ({ ...prev, google_ads_id: e.target.value }))}
                            placeholder="ex: AW-123456789"
                            className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{t('widgetConfig.tracking.googleConversionLabel')}</label>
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
                        {t('widgetConfig.tracking.successPathLabel')} <AlertCircle size={10} className="text-slate-500" title={t('widgetConfig.tracking.virtualPageviewTitle')} />
                    </label>
                    <input
                        type="text"
                        value={formData.success_virtual_path}
                        onChange={e => setFormData(prev => ({ ...prev, success_virtual_path: e.target.value }))}
                        placeholder="/agendamento-confirmado"
                        className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                    />
                    <p className="text-[9px] text-slate-500">
                        {t('widgetConfig.tracking.successPathHint')}
                    </p>
                </div>
            </div>

            {/* Snippet HTML e Teste ao Vivo */}
            <div className="bg-[#10172A] border border-[#1E293B] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                            <Eye className="text-sky-400" size={16} /> {t('widgetConfig.installTest.title')}
                        </h4>
                        <p className="text-[10px] text-slate-500">
                            {t('widgetConfig.installTest.subtitle')}
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
                            {widgetInjected ? t('widgetConfig.installTest.removeTestWidget') : t('widgetConfig.installTest.testOnPage')}
                        </button>
                    </div>
                </div>

                {/* Advanced Snippet Generator (CRO Route) */}
                <div className="bg-[#0A0F1D] border border-[#1E293B] rounded-xl p-4 space-y-3">
                    <div>
                        <h5 className="font-bold text-xs text-white">{t('widgetConfig.installTest.advancedGenTitle')}</h5>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            {t('widgetConfig.installTest.advancedGenSubtitle')}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                                {t('widgetConfig.installTest.lockSpecialtyLabel')}
                            </label>
                            <select
                                value={selectedSpecialtyFilter}
                                onChange={e => {
                                    setSelectedSpecialtyFilter(e.target.value);
                                    setSelectedDoctorFilter('');
                                }}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                            >
                                <option value="">{t('widgetConfig.installTest.noFilterOption')}</option>
                                {specialties.map(spec => (
                                    <option key={spec} value={spec}>{spec}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                                {t('widgetConfig.installTest.lockDoctorLabel')}
                            </label>
                            <select
                                value={selectedDoctorFilter}
                                onChange={e => setSelectedDoctorFilter(e.target.value)}
                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                            >
                                <option value="">{t('widgetConfig.installTest.anyDoctorOption')}</option>
                                {doctors
                                    .filter(d => !selectedSpecialtyFilter || d.specialty === selectedSpecialtyFilter)
                                    .map(d => (
                                        <option key={d.id} value={d.id}>
                                            {d.full_name} {d.specialty ? `(${d.specialty})` : ''}
                                        </option>
                                    ))}
                            </select>
                        </div>
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
                        {copied ? t('widgetConfig.installTest.copied') : t('widgetConfig.installTest.copyCode')}
                    </button>
                </div>

                {/* Mock Visual Preview of FAB */}
                <div className="border border-[#1E293B] rounded-xl p-4 bg-[#0A0F1D] flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">{t('widgetConfig.installTest.previewTitle')}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">{t('widgetConfig.installTest.previewSubtitle')}</p>
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
                    {t('widgetConfig.saveButton')}
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
