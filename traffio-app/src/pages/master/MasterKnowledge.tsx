import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Save, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { globalKnowledgeService, type GlobalKnowledge } from '../../services/globalKnowledgeService';

const LANGUAGES = ['pt-BR', 'en', 'es'] as const;

export const MasterKnowledge = () => {
    const { t } = useTranslation('master');
    const [rows, setRows] = useState<GlobalKnowledge[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try { setRows(await globalKnowledgeService.list()); }
        catch (error: any) { setMessage(error.message || t('knowledge.loadError')); }
        finally { setLoading(false); }
    }, [t]);
    useEffect(() => { void load(); }, [load]);

    const patchRow = (id: string, patch: Partial<GlobalKnowledge>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
    const save = async (row: GlobalKnowledge) => {
        setSaving(row.id); setMessage('');
        try { await globalKnowledgeService.update(row.id, { title: row.title, content: row.content, is_active: row.is_active }); setMessage(t('knowledge.saved')); }
        catch (error: any) { setMessage(error.message || t('knowledge.saveError')); }
        finally { setSaving(null); }
    };

    const topics = [...new Set(rows.map(row => row.topic_key))];
    return <div className="space-y-6 text-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-400">{t('knowledge.sectionLabel')}</p><h1 className="mt-2 text-3xl font-black text-white">{t('knowledge.headerTitle')}</h1><p className="mt-2 text-sm text-slate-400">{t('knowledge.headerSubtitle', { count: topics.length })}</p></div>
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-200"><AlertTriangle size={18} />{t('knowledge.warning')}</div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-indigo-100"><ShieldCheck size={18} className="text-indigo-300" />{t('knowledge.guardrail')}</div>
        {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div>}
        {loading ? <div className="py-12 text-center text-slate-500">{t('knowledge.loading')}</div> : <div className="space-y-5">{topics.map(topic => <section key={topic} className="rounded-2xl border border-[#1E293B] bg-[#0F1629] p-5">
            <div className="mb-4 flex items-center gap-3"><BookOpen size={18} className="text-indigo-400" /><h2 className="font-black text-white">{topic}</h2><span className="text-[10px] uppercase tracking-widest text-slate-500">{rows.find(row => row.topic_key === topic)?.category}</span></div>
            <div className="grid gap-4 xl:grid-cols-3">{LANGUAGES.map(language => { const row = rows.find(item => item.topic_key === topic && item.language === language); if (!row) return null; return <div key={row.id} className="space-y-3 rounded-xl border border-[#2D3B55] bg-[#131B31] p-4"><div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-widest text-indigo-300">{language}</span><button onClick={() => patchRow(row.id, { is_active: !row.is_active })} className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${row.is_active ? 'border-emerald-500/30 text-emerald-300' : 'border-slate-600 text-slate-500'}`}>{row.is_active ? t('knowledge.active') : t('knowledge.inactive')}</button></div><input value={row.title} onChange={event => patchRow(row.id, { title: event.target.value })} className="w-full rounded-lg border border-[#2D3B55] bg-[#0B101F] px-3 py-2 text-sm text-white" /><textarea value={row.content} onChange={event => patchRow(row.id, { content: event.target.value })} rows={5} className="w-full resize-y rounded-lg border border-[#2D3B55] bg-[#0B101F] px-3 py-2 text-sm leading-relaxed text-slate-200" /><button onClick={() => void save(row)} disabled={saving === row.id} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Save size={14} />{saving === row.id ? t('knowledge.saving') : t('knowledge.save')}</button></div>; })}</div>
        </section>)}</div>}
    </div>;
};
