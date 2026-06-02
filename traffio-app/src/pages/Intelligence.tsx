import { useState, useEffect } from 'react';
import {
    Brain,
    MessageSquare,
    Save,
    Loader2,
    Activity,
    Clock,
    AlertCircle,
    X,
    Check,
    Settings,
    ChevronDown,
    ChevronUp,
    Bell,
    Star,
    Video,
    Upload,
    Trash2,
    AlertTriangle,
    Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';

export interface BotConfig {
    enabled: boolean;
    active_agent: 'human' | 'ai_assistant' | 'flow_bot';
    no_show_prevention?: boolean;
    nps_enabled?: boolean;
    test_mode_15m?: boolean;
    reminder_videos_enabled?: boolean;
    reminder_videos?: {
        '48h'?: string | null;
        '24h'?: string | null;
        '2h'?: string | null;
        '15m'?: string | null;
    };
    reminder_captions?: {
        '48h'?: string;
        '24h'?: string;
        '2h'?: string;
        '15m'?: string;
    };
    active_reminders?: {
        '48h'?: boolean;
        '24h'?: boolean;
        '2h'?: boolean;
        '15m'?: boolean;
    };

    // Mantendo estes campos para compatibilidade de schema, mas não serão editáveis
    personality?: string;
    global_instructions?: string;
    identity?: { name: string; role: string };
    expertise?: string[];
    strict_rules?: string[];
    workflow?: string[];
}

export const Intelligence = () => {
    const { showToast } = useToast();
    const { tenant, loading: tenantLoading, refresh: refreshTenant } = useTenant();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<BotConfig>({
        enabled: true,
        active_agent: 'human',
        no_show_prevention: true,
        nps_enabled: true,
        test_mode_15m: false,
        reminder_videos_enabled: false,
        reminder_captions: {
            '48h': 'Olá! Passando para confirmar seu agendamento em 48 horas.',
            '24h': 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!',
            '2h': 'Lembrete: Seu agendamento é em 2 horas.',
            '15m': 'Estamos te aguardando em 5 minutos!'
        },
        active_reminders: {
            '48h': true,
            '24h': true,
            '2h': true,
            '15m': true
        }
    });

    useEffect(() => {
        if (!tenantLoading && tenant?.id) {
            fetchConfig();
        } else if (!tenantLoading) {
            setLoading(false);
        }
    }, [tenant?.id, tenantLoading]);

    const fetchConfig = async () => {
        try {
            if (!tenant?.id) return;

            const { data: tenantData, error } = await supabase
                .from('tenants')
                .select('bot_config')
                .eq('id', tenant.id)
                .single();

            if (error) {
                console.error('Error fetching tenant config:', error);
                return;
            }

            const savedConfig = tenantData?.bot_config as any;
            if (savedConfig) {
                setConfig({
                    ...savedConfig,
                    // Forçar modo humano no chat se não houver atendimento por IA
                    active_agent: 'human',
                    enabled: true,
                    // Garantir que captions existam
                    reminder_captions: savedConfig.reminder_captions || {
                        '48h': 'Olá! Passando para confirmar seu agendamento em 48 horas.',
                        '24h': 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!',
                        '2h': 'Lembrete: Seu agendamento é em 2 horas.',
                        '15m': 'Estamos te aguardando em 5 minutos!'
                    },
                    active_reminders: savedConfig.active_reminders || {
                        '48h': true,
                        '24h': true,
                        '2h': true,
                        '15m': true
                    }
                });
            }
        } catch (error) {
            console.error('Error fetching config:', error);
            showToast('error', 'Erro ao carregar configuração: ' + (error as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async () => {
        setSaving(true);
        try {
            if (!tenant?.id) throw new Error('Tenant não encontrado');

            // Garantir que o objeto de configuração esteja completo e limpo
            const payload = {
                ...config,

            };

            console.log('[DEBUG] Saving bot_config:', payload);

            const { error } = await supabase
                .from('tenants')
                .update({ bot_config: payload })
                .eq('id', tenant.id);

            if (error) throw error;

            await refreshTenant();
            showToast('success', 'Configurações de automação salvas com sucesso!');
        } catch (error: any) {
            console.error('[DEBUG] Error saving:', error);
            showToast('error', 'Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-primary" size={32} /></div>;

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
                    <Zap size={32} />
                </div>
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Central de Automações</h1>
                    <p className="text-graphite-400 font-medium tracking-tight">Gestão de Lembretes, NPS e Confirmações Audiovisuais.</p>
                </div>
            </div>

            <div className="space-y-6">
                <AutomationSettings 
                    config={config} 
                    setConfig={setConfig} 
                    onSave={saveConfig} 
                    saving={saving} 
                />
            </div>
        </div>
    );
};

const AutomationSettings = ({ config, setConfig, onSave, saving }: {
    config: BotConfig,
    setConfig: React.Dispatch<React.SetStateAction<BotConfig>>,
    onSave: () => void,
    saving: boolean
}) => {
    return (
        <div className="bg-white border border-ice-200 rounded-3xl shadow-sm overflow-hidden transition-all duration-300">
            <div className="p-8 space-y-8">
                {/* ── Seção Principal ── */}
                <div className="space-y-5">
                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-2">
                        <Activity size={14} className="text-brand-primary" /> Configurações de Ativação
                    </h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* No-show prevention */}
                        <div className="bg-ice-50/50 rounded-2xl border border-ice-100 px-5 py-6 flex items-center justify-between hover:bg-white hover:shadow-md transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-100 text-amber-600 rounded-lg group-hover:bg-amber-500 group-hover:text-white transition-colors">
                                    <Bell size={20} />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-graphite-900">Prevenção de No-Show</p>
                                    <p className="text-[10px] font-bold text-graphite-400">Confirmação 48h/24h + lembrete 2h</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setConfig(prev => ({ ...prev, no_show_prevention: !prev.no_show_prevention }))}
                                className={`relative w-12 h-6 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.no_show_prevention ? 'bg-amber-500' : 'bg-ice-200'}`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.no_show_prevention ? 'left-6' : 'left-0.5'}`} />
                            </button>
                        </div>

                        {/* NPS */}
                        <div className="bg-ice-50/50 rounded-2xl border border-ice-100 px-5 py-6 flex items-center justify-between hover:bg-white hover:shadow-md transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg group-hover:bg-blue-500 group-hover:text-white transition-colors">
                                    <Star size={20} />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-graphite-900">Pesquisa NPS</p>
                                    <p className="text-[10px] font-bold text-graphite-400">Pesquisa automática às 19h pós-consulta</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setConfig(prev => ({ ...prev, nps_enabled: !prev.nps_enabled }))}
                                className={`relative w-12 h-6 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.nps_enabled ? 'bg-blue-500' : 'bg-ice-200'}`}
                            >
                                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.nps_enabled ? 'left-6' : 'left-0.5'}`} />
                            </button>
                        </div>


                    </div>
                </div>

                {/* ── Lembretes Audiovisuais ── */}
                <div className="space-y-5 bg-indigo-50/30 p-8 rounded-3xl border border-indigo-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200">
                                <Video size={20} />
                            </div>
                            <div>
                                <h4 className="text-lg font-black text-graphite-900 tracking-tight">Vídeos de Confirmação</h4>
                                <p className="text-[10px] font-bold text-indigo-600 uppercase">Aumente a presença com mensagens personalizadas</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, reminder_videos_enabled: !prev.reminder_videos_enabled }))}
                            className={`relative w-12 h-6 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.reminder_videos_enabled ? 'bg-indigo-500' : 'bg-ice-200'}`}
                        >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.reminder_videos_enabled ? 'left-6' : 'left-0.5'}`} />
                        </button>
                    </div>

                    {config.reminder_videos_enabled && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                            <VideoReminderCard 
                                label="48 Horas Antes" 
                                enabled={config.active_reminders?.['48h'] ?? true}
                                onToggle={() => setConfig(prev => ({
                                    ...prev,
                                    active_reminders: { ...prev.active_reminders, '48h': !(prev.active_reminders?.['48h'] ?? true) }
                                }))}
                                videoUrl={config.reminder_videos?.['48h'] || null}
                                caption={config.reminder_captions?.['48h'] || ''}
                                onVideoChange={(url) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_videos: {...(prev.reminder_videos || {}), '48h': url}
                                }))}
                                onCaptionChange={(text) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_captions: {...(prev.reminder_captions || {}), '48h': text}
                                }))}
                            />
                            <VideoReminderCard 
                                label="24 Horas Antes" 
                                enabled={config.active_reminders?.['24h'] ?? true}
                                onToggle={() => setConfig(prev => ({
                                    ...prev,
                                    active_reminders: { ...prev.active_reminders, '24h': !(prev.active_reminders?.['24h'] ?? true) }
                                }))}
                                videoUrl={config.reminder_videos?.['24h'] || null}
                                caption={config.reminder_captions?.['24h'] || ''}
                                onVideoChange={(url) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_videos: {...(prev.reminder_videos || {}), '24h': url}
                                }))}
                                onCaptionChange={(text) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_captions: {...(prev.reminder_captions || {}), '24h': text}
                                }))}
                            />
                            <VideoReminderCard 
                                label="2 Horas Antes" 
                                enabled={config.active_reminders?.['2h'] ?? true}
                                onToggle={() => setConfig(prev => ({
                                    ...prev,
                                    active_reminders: { ...prev.active_reminders, '2h': !(prev.active_reminders?.['2h'] ?? true) }
                                }))}
                                videoUrl={config.reminder_videos?.['2h'] || null}
                                caption={config.reminder_captions?.['2h'] || ''}
                                onVideoChange={(url) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_videos: {...(prev.reminder_videos || {}), '2h': url}
                                }))}
                                onCaptionChange={(text) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_captions: {...(prev.reminder_captions || {}), '2h': text}
                                }))}
                            />
                            <VideoReminderCard 
                                label="🧪 Teste (5 Min)" 
                                enabled={config.active_reminders?.['15m'] ?? true}
                                onToggle={() => setConfig(prev => ({
                                    ...prev,
                                    active_reminders: { ...prev.active_reminders, '15m': !(prev.active_reminders?.['15m'] ?? true) }
                                }))}
                                videoUrl={config.reminder_videos?.['15m'] || null}
                                caption={config.reminder_captions?.['15m'] || ''}
                                onVideoChange={(url) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_videos: {...(prev.reminder_videos || {}), '15m': url}
                                }))}
                                onCaptionChange={(text) => setConfig(prev => ({
                                    ...prev, 
                                    reminder_captions: {...(prev.reminder_captions || {}), '15m': text}
                                }))}
                            />
                        </div>
                    )}

                    <div className="p-4 bg-white/50 rounded-2xl border border-indigo-100 flex items-center gap-3">
                        <AlertTriangle size={16} className="text-indigo-500 flex-shrink-0" />
                        <p className="text-xs font-bold text-indigo-800 leading-relaxed">
                            O vídeo será enviado como mídia principal e a mensagem de texto padrão será o "caption" (legenda). Use proporção 9:16 (vertical).
                        </p>
                    </div>
                </div>

                {/* ── Teste e Salvar ── */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-ice-100">
                    <div className="flex items-center gap-4 bg-ice-50 px-5 py-3 rounded-2xl border border-ice-100">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            <p className="text-[10px] font-black text-graphite-400 uppercase">Modo Teste (5m)</p>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, test_mode_15m: !prev.test_mode_15m }))}
                            className={`relative w-10 h-5 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.test_mode_15m ? 'bg-amber-500' : 'bg-ice-200'}`}
                        >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${config.test_mode_15m ? 'left-5' : 'left-0.5'}`} />
                        </button>
                    </div>

                    <button
                        onClick={() => onSave()}
                        disabled={saving}
                        className="w-full md:w-auto flex items-center justify-center gap-2 bg-brand-primary text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-brand-primary/20 hover:scale-105 active:scale-95 transition-all border-none cursor-pointer disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                        SALVAR ALTERAÇÕES
                    </button>
                </div>
            </div>
        </div>
    );
};

const VideoReminderCard = ({ label, enabled, onToggle, videoUrl, caption, onVideoChange, onCaptionChange }: { 
    label: string; 
    enabled: boolean;
    onToggle: () => void;
    videoUrl: string | null; 
    caption: string;
    onVideoChange: (url: string | null) => void;
    onCaptionChange: (text: string) => void;
}) => {
    const [uploading, setUploading] = useState(false);
    const { tenant } = useTenant();
    const { showToast } = useToast();

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !tenant?.id) return;

        if (file.size > 16 * 1024 * 1024) {
            showToast('error', 'O vídeo deve ter menos de 16MB.');
            return;
        }

        setUploading(true);
        try {
            const fileName = `${tenant.id}/video-reminders/${Date.now()}-${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('chat-media')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('chat-media')
                .getPublicUrl(fileName);

            onVideoChange(publicUrl);
            showToast('success', 'Vídeo carregado!');
        } catch (error: any) {
            console.error('Error uploading video:', error);
            showToast('error', 'Erro ao carregar vídeo.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={`p-5 rounded-2xl border transition-all group/card ${enabled ? 'bg-white/40 border-indigo-100/50 shadow-sm hover:shadow-md' : 'bg-ice-100/30 border-ice-200/50 opacity-60'}`}>
            <div className="flex items-center justify-between mb-4">
                <h5 className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{label}</h5>
                <button
                    onClick={onToggle}
                    className={`relative w-8 h-4 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${enabled ? 'bg-indigo-500' : 'bg-ice-300'}`}
                >
                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${enabled ? 'left-4.5' : 'left-0.5'}`} />
                </button>
            </div>
            
            <div className={`grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-4 ${!enabled && 'pointer-events-none'}`}>
                {/* Video Area */}
                <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-graphite-900 shadow-lg group">
                    {videoUrl ? (
                        <>
                            <video src={videoUrl} className="w-full h-full object-cover" muted autoPlay loop />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-end pb-3">
                                <button 
                                    onClick={() => onVideoChange(null)}
                                    className="bg-rose-500 text-white p-2 rounded-full shadow-lg border-none cursor-pointer hover:scale-110 transition-transform"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </>
                    ) : (
                        <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-white/10 transition-all group/upload">
                            {uploading ? (
                                <Loader2 size={20} className="text-brand-primary animate-spin" />
                            ) : (
                                <>
                                    <div className="p-2 bg-indigo-500/10 rounded-full text-indigo-400 group-hover/upload:bg-indigo-500 group-hover/upload:text-white transition-all">
                                        <Upload size={18} />
                                    </div>
                                    <span className="text-[8px] font-black text-indigo-400 uppercase mt-2">VÍDEO</span>
                                </>
                            )}
                            <input type="file" accept="video/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                        </label>
                    )}
                </div>

                {/* Text Area */}
                <div className="flex flex-col space-y-2">
                    <label className="text-[9px] font-black text-graphite-400 uppercase flex items-center gap-1.5">
                        <MessageSquare size={10} className="text-indigo-500" /> Legenda do Vídeo
                    </label>
                    <textarea 
                        value={caption}
                        onChange={(e) => onCaptionChange(e.target.value)}
                        placeholder="Digite a mensagem que acompanhará o vídeo..."
                        className="flex-1 w-full bg-white/80 border border-ice-200 rounded-xl p-3 text-xs font-medium text-graphite-700 placeholder:text-graphite-300 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none outline-none leading-relaxed"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-[8px] font-bold text-graphite-300 uppercase">Aprox. {caption.length} caracteres</span>
                        <div className="flex items-center gap-1">
                            <Check size={8} className="text-emerald-500" />
                            <span className="text-[8px] font-black text-emerald-500 uppercase">Sincronizado</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
