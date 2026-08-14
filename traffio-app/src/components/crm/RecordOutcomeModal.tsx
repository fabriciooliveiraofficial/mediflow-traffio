import { useState, useEffect } from 'react';
import { CheckCircle2, X, DollarSign, Save, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';

interface RecordOutcomeModalProps {
    isOpen: boolean;
    appointmentId: string | null;
    dateLabel: string;
    journeyId: string | null;
    defaultProcedure?: string;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Único caminho do produto que grava appointments.status = 'completed' — o
 * gatilho exclusivo da pesquisa NPS. Compartilhado entre FollowUpTimelineDrawer
 * (Registrar Desfecho) e AgendaMestra (botão Concluído) para que o dado
 * financeiro capturado aqui seja sempre o mesmo, não importa a tela de origem.
 */
export function RecordOutcomeModal({ isOpen, appointmentId, dateLabel, journeyId, defaultProcedure, onClose, onSaved }: RecordOutcomeModalProps) {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const [procedure, setProcedure] = useState('');
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setProcedure(defaultProcedure || '');
            setValue('');
        }
    }, [isOpen, appointmentId, defaultProcedure]);

    if (!isOpen || !appointmentId) return null;

    const handleSave = async () => {
        setSaving(true);
        try {
            // Marca como concluída → trigger do CRM Journey Engine avança o card
            // automaticamente para "Compareceu" e mantém o kanban sincronizado.
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', appointmentId);
            if (aptErr) throw aptErr;

            const revenueNum = parseFloat(value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
            if (journeyId && (revenueNum > 0 || procedure.trim())) {
                // Lê o estágio direto do servidor nesse instante — nunca decide uma
                // transição real a partir de estado de cliente potencialmente obsoleto
                // (o paciente pode ter avançado no funil enquanto este modal estava aberto).
                const { data: freshJourney } = await supabase
                    .from('crm_journeys')
                    .select('stage_id')
                    .eq('id', journeyId)
                    .maybeSingle();
                const freshStage = freshJourney?.stage_id;

                if (freshStage) {
                    await supabase.rpc('crm_move_stage', {
                        p_journey_id: journeyId,
                        p_to_stage: freshStage === 'showed_up' ? 'proposal' : freshStage,
                        p_actor: 'user',
                        p_extra: {
                            ...(revenueNum > 0 ? { revenue_estimated: revenueNum } : {}),
                            ...(procedure.trim() ? { procedure_name: procedure.trim() } : {}),
                        },
                    }).then(({ error }) => {
                        // Transição pode ser no-op (mesmo estágio) — apenas os dados extras importam aqui.
                        if (error && error.code !== '22023') throw error;
                    });
                }
            }

            onSaved();
        } catch (e: any) {
            showToast('error', t('timeline.toasts.completedError', { defaultValue: 'Erro ao registrar resultado.' }));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-ice-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-graphite-900">{t('timeline.outcomeModal.title', { defaultValue: 'Registrar Resultado' })}</h3>
                            <p className="text-xs text-graphite-500 font-medium">{dateLabel}</p>
                        </div>
                    </div>
                    <IconButton onClick={onClose}>
                        <X className="w-5 h-5" />
                    </IconButton>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">
                            {t('timeline.outcomeModal.procedureLabel', { defaultValue: 'Procedimento Realizado' })}
                        </label>
                        <input
                            type="text"
                            value={procedure}
                            onChange={(e) => setProcedure(e.target.value)}
                            placeholder={t('timeline.outcomeModal.procedurePlaceholder', { defaultValue: 'Ex: Consulta de avaliação, Limpeza, Implante...' })}
                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">
                            {t('timeline.outcomeModal.valueLabel', { defaultValue: 'Valor do Procedimento (opcional)' })}
                        </label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite-400" />
                            <input
                                type="text"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder="0,00"
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="p-3 bg-emerald-50 rounded-xl flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                            {t('timeline.outcomeModal.npsHint', { defaultValue: 'A pesquisa NPS será enviada automaticamente ao paciente após o prazo configurado em Inteligência.' })}
                        </p>
                    </div>
                </div>

                <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                    <Button variant="ghost" className="flex-1 justify-center" onClick={onClose}>
                        {t('timeline.outcomeModal.cancel', { defaultValue: 'Cancelar' })}
                    </Button>
                    <Button variant="success" className="flex-1 justify-center" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t('timeline.outcomeModal.save', { defaultValue: 'Confirmar Realização' })}
                    </Button>
                </div>
            </div>
        </div>
    );
}
