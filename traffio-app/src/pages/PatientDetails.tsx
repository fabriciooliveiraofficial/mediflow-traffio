import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    Calendar,
    Phone,
    Mail,
    FileText,
    Activity,
    Plus,
    Stethoscope,
    ShieldCheck,
    ClipboardList,
    FlaskConical,
    Pill,
    History,
    Activity as DentalIcon,
    Calculator,
    Scan,
    Apple,
    Wallet,
    ExternalLink,
    Eye,
    Pencil,
    Ban,
    RefreshCw,
    Trash2,
    History as HistoryIcon
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NewMedicalRecordModal } from '../components/NewMedicalRecordModal';
import { usePatientTimeline } from '../hooks/usePatientTimeline';
import { TimelineCard } from '../components/timeline/TimelineCard';
import { AIExplainButton } from '../components/timeline/AIExplainButton';
import { NewPrescriptionModal } from '../components/NewPrescriptionModal';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { ViewPrescriptionModal } from '../components/ViewPrescriptionModal';
import { Odontogram } from '../components/dental/Odontogram';
import { NewDentalBudgetModal } from '../components/dental/NewDentalBudgetModal';
import { AnthropometryForm } from '../components/nutrition/AnthropometryForm';
import { CheckoutModal } from '../components/CheckoutModal';
import { DocumentPreviewModal } from '../components/shared/DocumentPreviewModal';
import { VoidReasonModal } from '../components/shared/VoidReasonModal';
import { dentalService } from '../services/dentalService';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTenantMoney } from '../hooks/useTenantMoney';
import { formatDisplayDate } from '../lib/dateUtils';
import { formatDoc, docLabel } from '../lib/i18n/doc';
import { resolvePatientCountry } from '../lib/i18n/countryFormats';
import { formatNational, toE164 } from '../lib/i18n/phone';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { ChannelPreferenceSelector } from '../components/channel/ChannelPreferenceSelector';
import { prescriptionSummary } from '../lib/prescriptions';
import { logClinicalAction } from '../lib/clinicalAudit';

interface PatientDetailsProps {
    patientId: string;
    onBack: () => void;
}

export const PatientDetails: React.FC<PatientDetailsProps> = ({ patientId, onBack }) => {
    const { t } = useTranslation('medical');
    const { tenant } = useTenant();
    const { formatDate, formatDateTime } = useLocaleFormat();
    const { format: formatMoney } = useTenantMoney();
    const [activeTab, setActiveTab] = useState<'timeline' | 'medical-record' | 'dental' | 'exams' | 'nutrition' | 'calls'>('timeline');
    const [callRecords, setCallRecords]   = useState<any[]>([]);
    const [callsLoading, setCallsLoading] = useState(false);
    const [patient, setPatient] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
    const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
    const [isExamModalOpen, setIsExamModalOpen] = useState(false);
    const [isViewPrescriptionOpen, setIsViewPrescriptionOpen] = useState(false);
    const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
    const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<any>(null);
    const [dentalBudgets, setDentalBudgets] = useState<any[]>([]);
    const [selectedPrescription, setSelectedPrescription] = useState<any>(null);
    const [explainTerm, setExplainTerm] = useState<string | null>(null);
    const [prescriptions, setPrescriptions] = useState<any[]>([]);
    const [exams, setExams] = useState<any[]>([]);
    const [financingProposals, setFinancingProposals] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [medicalRecords, setMedicalRecords] = useState<any[]>([]);
    const [medicalRecordsLoading, setMedicalRecordsLoading] = useState(true);
    const [showVoidedRecords, setShowVoidedRecords] = useState(false);
    const [amendingRecord, setAmendingRecord] = useState<any>(null);
    const [voidTarget, setVoidTarget] = useState<{ type: 'medical_record' | 'prescription' | 'document'; id: string; label: string } | null>(null);
    const [replacingExam, setReplacingExam] = useState<any>(null);

    const { showToast } = useToast();
    const { events: timelineEvents, loading: timelineLoading, refresh: refreshTimeline } = usePatientTimeline(patientId);

    // I.4 — Buscar histórico de chamadas do paciente
    useEffect(() => {
        if (activeTab !== 'calls' || !patient || !tenant?.id) return;
        setCallsLoading(true);
        const country = (patient.country as CountryCode) || (tenant?.country as CountryCode) || DEFAULT_COUNTRY;
        const e164 = patient.phone ? toE164(patient.phone, country) : null;
        const phone = e164 || patient.phone || '';
        if (!phone) { setCallsLoading(false); setCallRecords([]); return; }
        supabase
            .from('call_records')
            .select('id, direction, from_number, to_number, status, duration_seconds, started_at, answered_at, call_notes')
            .eq('tenant_id', tenant.id)
            .or(`from_number.eq.${phone},to_number.eq.${phone}`)
            .order('started_at', { ascending: false })
            .limit(20)
            .then(({ data }) => { setCallRecords(data ?? []); setCallsLoading(false); });
    }, [activeTab, patient, tenant?.id, tenant?.country]);

    useEffect(() => {
        fetchPatientData();

        const channel = supabase
            .channel(`patient_changes_${patientId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'patients',
                    filter: `id=eq.${patientId}`,
                },
                (payload) => {
                    setPatient(payload.new);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [patientId]);

    useEffect(() => {
        if (activeTab !== 'timeline') {
            fetchHistoryData();
        }
        if (activeTab === 'medical-record') {
            fetchMedicalRecords();
        }
    }, [activeTab]);

    const fetchPatientData = async () => {
        try {
            setLoading(true);

            // Fetch patient details
            const { data: patientData, error: patientError } = await supabase
                .from('patients')
                .select('*')
                .eq('id', patientId)
                .single();

            if (patientError) throw patientError;
            setPatient(patientData);

            // Fetch history data (prescriptions and exams)
            await fetchHistoryData();

        } catch (error) {
            console.error('Error fetching patient details:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchHistoryData = async () => {
        try {
            setHistoryLoading(true);
            
            // Fetch Prescriptions (ativas — anuladas ficam fora da lista rápida, mas seguem no audit log)
            const { data: prescriptionsData } = await supabase
                .from('prescriptions')
                .select('*')
                .eq('patient_id', patientId)
                .is('voided_at', null)
                .order('created_at', { ascending: false });

            setPrescriptions(prescriptionsData || []);

            // Fetch Exams (não excluídos; mostra só a versão mais recente de cada documento)
            const { data: examsData } = await supabase
                .from('documents')
                .select('*')
                .eq('patient_id', patientId)
                .eq('category', 'exam_result')
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            setExams(examsData || []);

            // Fetch Financing Proposals
            const { data: financingData } = await supabase
                .from('financing_proposals')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });

            setFinancingProposals(financingData || []);

            if (tenant?.specialty?.includes('dental')) {
                const budgets = await dentalService.getBudgets(patientId);
                setDentalBudgets(budgets || []);
            }

        } catch (error: any) {
            console.error('Error fetching history data:', error);
            showToast('error', t('patientDetails.toasts.historyLoadErrorPrefix') + error.message);
        } finally {
            setHistoryLoading(false);
        }
    };

    const fetchMedicalRecords = async () => {
        try {
            setMedicalRecordsLoading(true);
            const { data } = await supabase
                .from('medical_records')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });
            setMedicalRecords(data || []);
        } catch (error) {
            console.error('Error fetching medical records:', error);
        } finally {
            setMedicalRecordsLoading(false);
        }
    };

    const handleVoidConfirm = async (reason: string) => {
        if (!voidTarget || !tenant?.id) return;
        const { data: { user } } = await supabase.auth.getUser();
        const table = voidTarget.type === 'medical_record' ? 'medical_records' : 'prescriptions';
        const { error } = await supabase
            .from(table)
            .update({ voided_at: new Date().toISOString(), voided_reason: reason, voided_by: user?.id })
            .eq('id', voidTarget.id);

        if (error) {
            showToast('error', t('patientDetails.toasts.voidError') + error.message);
            return;
        }

        await logClinicalAction({
            tenantId: tenant.id,
            entityType: voidTarget.type,
            entityId: voidTarget.id,
            action: 'voided',
            reason,
        });

        showToast('success', t('patientDetails.toasts.voided'));
        setVoidTarget(null);
        if (voidTarget.type === 'medical_record') fetchMedicalRecords();
        fetchHistoryData();
        refreshTimeline();
    };

    const handleDeleteExamConfirm = async (reason: string) => {
        if (!voidTarget || !tenant?.id || voidTarget.type !== 'document') return;
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase
            .from('documents')
            .update({ deleted_at: new Date().toISOString(), deleted_reason: reason, deleted_by: user?.id })
            .eq('id', voidTarget.id);

        if (error) {
            showToast('error', t('patientDetails.toasts.voidError') + error.message);
            return;
        }

        await logClinicalAction({
            tenantId: tenant.id,
            entityType: 'document',
            entityId: voidTarget.id,
            action: 'soft_deleted',
            reason,
        });

        showToast('success', t('patientDetails.toasts.examDeleted'));
        setVoidTarget(null);
        fetchHistoryData();
        refreshTimeline();
    };

    const handleReissuePrescription = async (presc: any) => {
        if (!tenant?.id) return;
        const { data: { user } } = await supabase.auth.getUser();

        // 1. Anula a receita original
        const { error: voidError } = await supabase
            .from('prescriptions')
            .update({ voided_at: new Date().toISOString(), voided_reason: t('patientDetails.reissueVoidReason'), voided_by: user?.id })
            .eq('id', presc.id);
        if (voidError) {
            showToast('error', t('patientDetails.toasts.voidError') + voidError.message);
            return;
        }

        // 2. Cria a nova, linkada à anterior
        const { data: inserted, error: insertError } = await supabase
            .from('prescriptions')
            .insert([{
                patient_id: patientId,
                tenant_id: tenant.id,
                content_json: presc.content_json,
                reissued_from_id: presc.id,
            }])
            .select('id')
            .single();

        if (insertError) {
            showToast('error', t('patientDetails.toasts.reissueError') + insertError.message);
            return;
        }

        await logClinicalAction({ tenantId: tenant.id, entityType: 'prescription', entityId: presc.id, action: 'voided', reason: t('patientDetails.reissueVoidReason') });
        if (inserted) {
            await logClinicalAction({ tenantId: tenant.id, entityType: 'prescription', entityId: inserted.id, action: 'reissued', reason: t('patientDetails.reissueReasonAudit', { id: presc.id.slice(0, 8) }) });
        }

        showToast('success', t('patientDetails.toasts.reissued'));
        fetchHistoryData();
        refreshTimeline();
    };

    const handleOpenIDocs = () => {
        if (!patient?.cpf) {
            showToast('warning', t('patientDetails.toasts.idocsCpfRequired'));
            return;
        }
        window.open('https://s3.radiomemory.com.br/', '_blank');
        showToast('info', t('patientDetails.toasts.idocsOpening'));
    };

    if (loading) {
        return <div className="p-12 text-center text-graphite-400 font-medium">{t('patientDetails.loading')}</div>;
    }

    if (!patient) {
        return <div className="p-12 text-center text-accent-error font-medium">{t('patientDetails.notFound')}</div>;
    }

    return (
        <div className="space-y-8 pb-24 md:pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Navigation & Actions */}
            <div className="flex items-center justify-between">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-graphite-500 hover:text-brand-primary font-bold bg-transparent border-none cursor-pointer transition-colors"
                >
                    <ArrowLeft size={20} />
                    <span>{t('patientDetails.backToList')}</span>
                </button>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCheckoutModalOpen(true)}
                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-500/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <Wallet size={18} />
                        <span>{t('patientDetails.newFinancingProposal')}</span>
                    </button>
                    <button
                        onClick={() => setIsRecordModalOpen(true)}
                        className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <Plus size={18} />
                        <span>{t('patientDetails.newEvolution')}</span>
                    </button>
                </div>
            </div>

            {/* Patient Header Card */}
            <div className="bg-white rounded-[32px] p-8 border border-ice-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />

                <div className="flex flex-col md:flex-row gap-8 relative z-10">
                    {/* Avatar Area */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-32 h-32 rounded-3xl bg-ice-100 flex items-center justify-center text-4xl font-black text-brand-primary shadow-inner border-4 border-white">
                            {patient.full_name.charAt(0)}
                        </div>
                        <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-black uppercase tracking-wide">
                            {t('patientDetails.active')}
                        </span>
                        {patient.last_visit_at && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-lg border border-amber-100 mt-2">
                                <History size={10} className="text-amber-600" />
                                <span className="text-[9px] font-black text-amber-700 uppercase">
                                    {t('patientDetails.recallPrefix', { date: formatDate(patient.last_visit_at) })}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Info Area */}
                    <div className="flex-1 space-y-6">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h1 className="text-3xl font-black text-graphite-900 tracking-tight leading-none">
                                    {patient.full_name}
                                </h1>
                                {patient.type === 'insurance' ? (
                                    <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-md text-[10px] font-black uppercase border border-sky-200">
                                        {patient.insurance_provider || t('patientDetails.insuranceFallback')}
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-[10px] font-black uppercase border border-amber-200">
                                        {t('patientDetails.private')}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-graphite-500 font-medium">
                                <span className="flex items-center gap-2">
                                    <FileText size={16} className="text-brand-primary" />
                                    {docLabel(resolvePatientCountry(patient.country, tenant?.country, patient.cpf, patient.national_id))}: {
                                        patient.national_id || patient.cpf
                                            ? formatDoc(patient.national_id || patient.cpf, resolvePatientCountry(patient.country, tenant?.country, patient.cpf, patient.national_id))
                                            : t('patientDetails.docNotInformed')
                                    }
                                </span>
                                <span className="flex items-center gap-2">
                                    <Calendar size={16} className="text-brand-primary" />
                                    {t('patientDetails.birthDatePrefix', { date: formatDisplayDate(patient.birth_date) || '--/--/----' })}
                                </span>
                                {(patient.insurance_card_number || patient.insurance_card) && (
                                    <span className="flex items-center gap-2">
                                        <ShieldCheck size={16} className="text-emerald-500" />
                                        {t('patientDetails.cardPrefix', { card: patient.insurance_card_number || patient.insurance_card })}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl bg-ice-50 border border-ice-100 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand-primary shadow-sm">
                                    <Phone size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">{t('patientDetails.mobileLabel')}</p>
                                    <p className="font-bold text-graphite-900">{formatNational(patient.phone, resolvePatientCountry(patient.country, tenant?.country, patient.cpf, patient.national_id)) || patient.phone || t('patientDetails.mobileNotRegistered')}</p>
                                </div>
                                {/* I.1 — Click-to-call: dispara o softphone via evento global */}
                                {patient.phone && (tenant as any)?.telnyx_enabled && (
                                    <button
                                        onClick={() => window.dispatchEvent(new CustomEvent('softphone:dial', { detail: { number: patient.phone } }))}
                                        className="w-9 h-9 rounded-xl bg-green-500 hover:bg-green-600 flex items-center justify-center text-white transition-colors border-none cursor-pointer shrink-0"
                                        title={t('patientDetails.callTitle', { number: patient.phone })}
                                    >
                                        <Phone size={16} />
                                    </button>
                                )}
                            </div>
                            <div className="p-4 rounded-2xl bg-ice-50 border border-ice-100 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand-primary shadow-sm">
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">{t('patientDetails.emailLabel')}</p>
                                    <p className="font-bold text-graphite-900">{patient.email || t('patientDetails.emailNotRegistered')}</p>
                                </div>
                            </div>
                        </div>

                        {/* Preferências de Notificação */}
                        {tenant?.id && patient.phone && (
                            <div className="p-5 rounded-2xl bg-ice-50 border border-ice-100">
                                <ChannelPreferenceSelector
                                    tenantId={tenant.id}
                                    patientPhone={patient.phone}
                                    enabledChannels={tenant.bot_config?.enabled_channels}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Adaptive Tabs Navigation */}
            <div className="flex items-center gap-2 p-1.5 bg-ice-100/50 rounded-2xl w-fit">
                <button
                    onClick={() => setActiveTab('timeline')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'timeline' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-400 hover:text-graphite-600'}`}
                >
                    <History size={14} />
                    {t('patientDetails.tabs.timeline')}
                </button>
                {/* I.4 — Aba de chamadas (visível quando softphone ativo) */}
                {(tenant as any)?.telnyx_enabled && (
                    <button
                        onClick={() => setActiveTab('calls')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'calls' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-400 hover:text-graphite-600'}`}
                    >
                        <Phone size={14} />
                        {t('patientDetails.tabs.calls')}
                    </button>
                )}
                <button
                    onClick={() => setActiveTab('medical-record')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'medical-record' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-400 hover:text-graphite-600'}`}
                >
                    <Stethoscope size={14} />
                    {t('patientDetails.tabs.medicalRecord')}
                </button>
                {tenant?.specialty?.includes('dental') && (
                    <button
                        onClick={() => setActiveTab('dental')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'dental' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-graphite-400 hover:text-emerald-500'}`}
                    >
                        <DentalIcon size={14} />
                        {t('patientDetails.tabs.dental')}
                    </button>
                )}
                <button
                    onClick={() => setActiveTab('exams')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'exams' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-graphite-400 hover:text-indigo-600'}`}
                >
                    <Scan size={14} />
                    {t('patientDetails.tabs.exams')}
                </button>
                {tenant?.specialty?.includes('nutrition') && (
                    <button
                        onClick={() => setActiveTab('nutrition')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'nutrition' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-graphite-400 hover:text-indigo-600'}`}
                    >
                        <Apple size={14} />
                        {t('patientDetails.tabs.nutrition')}
                    </button>
                )}
            </div>

            {/* Content Tabs / Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Timeline / Specialized Views */}
                <div className="lg:col-span-2 min-w-0 space-y-6">
                    {activeTab === 'timeline' && (
                        <>
                            <div className="flex items-center gap-3 mb-4">
                                <Activity className="text-brand-primary" />
                                <h3 className="text-xl font-black text-graphite-900">{t('patientDetails.timeline.heading')}</h3>
                            </div>

                            <div className="relative border-l-2 border-ice-200 ml-3 space-y-8 pl-8 pb-8">
                                {timelineLoading ? (
                                    <div className="space-y-4">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="animate-pulse">
                                                <div className="h-28 bg-ice-100 rounded-2xl" />
                                            </div>
                                        ))}
                                    </div>
                                ) : timelineEvents.length === 0 ? (
                                    <div className="p-6 rounded-2xl bg-white border border-ice-200 text-center text-graphite-400 font-medium">
                                        <Stethoscope size={32} className="mx-auto mb-3 text-ice-300" />
                                        <p>{t('patientDetails.timeline.emptyTitle')}</p>
                                        <p className="text-sm">{t('patientDetails.timeline.emptySubtitle')}</p>
                                    </div>
                                ) : (
                                    timelineEvents.map((event) => (
                                        <TimelineCard
                                            key={event.id}
                                            event={event}
                                            onExplain={(term) => setExplainTerm(term)}
                                        />
                                    ))
                                )}
                            </div>
                        </>
                    )}

                    {/* I.4 — Aba de chamadas do paciente */}
                    {activeTab === 'calls' && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            {callsLoading ? (
                                <div className="flex justify-center py-12">
                                    <div className="w-8 h-8 border-2 border-ice-100 border-t-brand-primary rounded-full animate-spin" />
                                </div>
                            ) : callRecords.length === 0 ? (
                                <div className="bg-white border border-ice-100 rounded-[32px] p-12 text-center space-y-3">
                                    <div className="w-16 h-16 rounded-full bg-ice-50 flex items-center justify-center mx-auto">
                                        <Phone size={28} className="text-graphite-300" />
                                    </div>
                                    <p className="font-black text-graphite-500">{t('patientDetails.calls.emptyTitle')}</p>
                                    <p className="text-sm text-graphite-400">{t('patientDetails.calls.emptySubtitle')}</p>
                                </div>
                            ) : callRecords.map((call) => (
                                <div key={call.id} className="bg-white border border-ice-100 rounded-2xl p-4 flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                        call.status === 'missed' ? 'bg-red-50' :
                                        call.direction === 'inbound' ? 'bg-green-50' : 'bg-blue-50'
                                    }`}>
                                        <Phone size={18} className={
                                            call.status === 'missed' ? 'text-red-400' :
                                            call.direction === 'inbound' ? 'text-green-500' : 'text-blue-500'
                                        } />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-black text-graphite-800">
                                            {call.direction === 'inbound' ? t('patientDetails.calls.inbound') : t('patientDetails.calls.outbound')}
                                            {call.status === 'missed' && t('patientDetails.calls.missedSuffix')}
                                        </p>
                                        <p className="text-xs text-graphite-400">
                                            {formatDateTime(call.started_at)}
                                            {call.duration_seconds && ` · ${Math.floor(call.duration_seconds / 60)}m${call.duration_seconds % 60}s`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => window.dispatchEvent(new CustomEvent('softphone:dial', { detail: { number: call.direction === 'inbound' ? call.from_number : call.to_number } }))}
                                        className="w-8 h-8 rounded-xl bg-green-50 hover:bg-green-100 text-green-600 flex items-center justify-center border-none cursor-pointer shrink-0"
                                        title={t('patientDetails.calls.callBackTitle')}
                                    >
                                        <Phone size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'medical-record' && (() => {
                        const voidedCount = medicalRecords.filter(r => r.voided_at).length;
                        const visibleRecords = medicalRecords.filter(r => showVoidedRecords || !r.voided_at);
                        return (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {voidedCount > 0 && (
                                    <button
                                        onClick={() => setShowVoidedRecords(v => !v)}
                                        className="flex items-center gap-1.5 text-[10px] font-black text-graphite-400 hover:text-graphite-700 uppercase tracking-wider bg-transparent border-none cursor-pointer"
                                    >
                                        <HistoryIcon size={12} />
                                        {showVoidedRecords ? t('patientDetails.medicalRecord.hideVoided') : t('patientDetails.medicalRecord.showVoided', { count: voidedCount })}
                                    </button>
                                )}
                                {medicalRecordsLoading ? (
                                    <div className="space-y-4">
                                        {[1, 2].map(i => <div key={i} className="h-40 bg-ice-100 rounded-[28px] animate-pulse" />)}
                                    </div>
                                ) : visibleRecords.length === 0 ? (
                                    <div className="bg-white border border-ice-100 rounded-[32px] p-12 text-center space-y-4">
                                        <div className="w-20 h-20 rounded-full bg-ice-50 flex items-center justify-center mx-auto text-brand-primary">
                                            <FileText size={40} />
                                        </div>
                                        <h3 className="text-xl font-black text-graphite-900">{t('patientDetails.medicalRecord.title')}</h3>
                                        <p className="text-sm text-graphite-500 max-w-xs mx-auto">{t('patientDetails.medicalRecord.subtitle')}</p>
                                        <button
                                            onClick={() => { setAmendingRecord(null); setIsRecordModalOpen(true); }}
                                            className="px-6 py-3 bg-brand-primary text-white rounded-2xl font-black text-sm hover:scale-105 transition-all border-none cursor-pointer"
                                        >
                                            <Plus size={16} className="inline mr-1" /> {t('patientDetails.newEvolution')}
                                        </button>
                                    </div>
                                ) : (
                                    visibleRecords.map((record) => {
                                        const soap = record.soap_notes;
                                        const title = record.title || soap?.a || t('patientTimeline.consultationFallback');
                                        const isVoided = !!record.voided_at;
                                        return (
                                            <div key={record.id} className={`bg-white border rounded-[28px] p-6 shadow-sm ${isVoided ? 'border-rose-100 opacity-60' : 'border-ice-100'}`}>
                                                <div className="flex items-center justify-between mb-3 gap-3">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <h4 className="font-black text-graphite-900 truncate">{title}</h4>
                                                        {record.amends_id && (
                                                            <span className="px-2 py-0.5 bg-sky-50 text-sky-600 rounded text-[9px] font-black uppercase shrink-0">
                                                                {t('patientDetails.medicalRecord.amendmentBadge')}
                                                            </span>
                                                        )}
                                                        {isVoided && (
                                                            <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded text-[9px] font-black uppercase shrink-0">
                                                                {t('patientDetails.medicalRecord.voidedBadge')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="text-xs font-bold text-graphite-400">{formatDate(record.created_at)}</span>
                                                        {!isVoided && (
                                                            <>
                                                                <button
                                                                    onClick={() => { setAmendingRecord(record); setIsRecordModalOpen(true); }}
                                                                    title={t('patientDetails.medicalRecord.edit')}
                                                                    className="p-1.5 bg-ice-50 hover:bg-brand-primary hover:text-white text-graphite-400 rounded-lg transition-all cursor-pointer border-none"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                                <button
                                                                    onClick={() => setVoidTarget({ type: 'medical_record', id: record.id, label: title })}
                                                                    title={t('patientDetails.medicalRecord.void')}
                                                                    className="p-1.5 bg-ice-50 hover:bg-rose-500 hover:text-white text-graphite-400 rounded-lg transition-all cursor-pointer border-none"
                                                                >
                                                                    <Ban size={12} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                {isVoided && record.voided_reason && (
                                                    <p className="text-xs text-rose-500 font-medium italic mb-3">
                                                        {t('patientDetails.medicalRecord.voidedReasonPrefix')} {record.voided_reason}
                                                    </p>
                                                )}
                                                {soap && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        {soap.s && <SoapField label={t('newMedicalRecordModal.subjective.label')} text={soap.s} />}
                                                        {soap.o && <SoapField label={t('newMedicalRecordModal.objective.label')} text={soap.o} />}
                                                        {soap.a && <SoapField label={t('newMedicalRecordModal.assessment.label')} text={soap.a} />}
                                                        {soap.p && <SoapField label={t('newMedicalRecordModal.plan.label')} text={soap.p} />}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        );
                    })()}

                    {activeTab === 'dental' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                            <div className="flex items-center justify-between bg-emerald-500/10 p-6 rounded-[32px] border border-emerald-500/20">
                                <div>
                                    <h3 className="text-xl font-black text-emerald-800">{t('patientDetails.dental.title')}</h3>
                                    <p className="text-sm text-emerald-700 font-medium">{t('patientDetails.dental.subtitle')}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleOpenIDocs}
                                        className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-600 px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-indigo-100 transition-all cursor-pointer"
                                        title={t('patientDetails.dental.idocsTitle')}
                                    >
                                        <ExternalLink size={18} />
                                        <span>iDocs</span>
                                    </button>
                                    <button
                                        onClick={() => setIsBudgetModalOpen(true)}
                                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-500/20 hover:scale-105 transition-transform border-none cursor-pointer"
                                    >
                                        <Calculator size={18} />
                                        <span>{t('patientDetails.dental.generateTreatmentPlan')}</span>
                                    </button>
                                </div>
                            </div>
                            <Odontogram patientId={patientId} />
                        </div>
                    )}

                    {activeTab === 'exams' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {historyLoading ? (
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    {[1, 2, 3].map(i => <div key={i} className="h-32 bg-ice-100 rounded-[28px] animate-pulse" />)}
                                </div>
                            ) : exams.length === 0 ? (
                                <div className="bg-white border border-ice-100 rounded-[32px] p-12 text-center space-y-3">
                                    <div className="w-16 h-16 rounded-full bg-ice-50 flex items-center justify-center mx-auto">
                                        <FlaskConical size={28} className="text-graphite-300" />
                                    </div>
                                    <p className="font-black text-graphite-500">{t('patientDetails.sidebar.examsEmpty')}</p>
                                    <button
                                        onClick={() => setIsExamModalOpen(true)}
                                        className="px-6 py-3 bg-emerald-500 text-white rounded-2xl font-black text-sm hover:scale-105 transition-all border-none cursor-pointer"
                                    >
                                        <Plus size={16} className="inline mr-1" /> {t('patientDetails.sidebar.examsTitle')}
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    {exams.map((exam) => (
                                        <div
                                            key={exam.id}
                                            className="group relative bg-white p-5 rounded-[28px] border border-ice-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all flex flex-col gap-3"
                                        >
                                            <div className="absolute top-3 right-3 flex items-center gap-1">
                                                <button
                                                    onClick={() => { setReplacingExam({ id: exam.id, version: exam.version || 1, filename: exam.filename }); setIsExamModalOpen(true); }}
                                                    title={t('patientDetails.sidebar.replace')}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-indigo-600 transition-all cursor-pointer"
                                                >
                                                    <RefreshCw size={12} />
                                                </button>
                                                <button
                                                    onClick={() => setVoidTarget({ type: 'document', id: exam.id, label: exam.filename })}
                                                    title={t('patientDetails.sidebar.delete')}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-rose-500 transition-all cursor-pointer"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => setPreviewDoc(exam)}
                                                className="bg-transparent border-none cursor-pointer text-left p-0 flex flex-col gap-3"
                                            >
                                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                                    <FlaskConical size={24} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-sm truncate text-graphite-900" title={exam.filename}>{exam.filename}</p>
                                                    <p className="text-[10px] font-medium text-graphite-400 uppercase tracking-widest mt-1">
                                                        {formatDate(exam.created_at)}
                                                    </p>
                                                </div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'nutrition' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                            <div className="flex justify-between items-center bg-indigo-600 p-6 rounded-[32px] text-white shadow-xl shadow-indigo-600/10">
                                <div>
                                    <h3 className="text-xl font-black">{t('patientDetails.nutrition.title')}</h3>
                                    <p className="text-sm opacity-80 font-medium">{t('patientDetails.nutrition.subtitle')}</p>
                                </div>
                            </div>
                            <AnthropometryForm 
                                patientId={patientId}
                                onSuccess={() => {
                                    fetchHistoryData();
                                    setActiveTab('timeline');
                                }}
                            />
                        </div>
                    )}

                    {/* AI Explain Modal */}
                    {explainTerm && (
                        <AIExplainButton term={explainTerm} onClose={() => setExplainTerm(null)} />
                    )}
                </div>

                {/* Right Column: Quick Info */}
                <div className="min-w-0 space-y-6">
                    {/* Receitas */}
                    <div className="bg-white rounded-2xl border border-ice-200 overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                            <div className="flex items-center gap-2">
                                <ClipboardList size={18} className="text-brand-primary" />
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">{t('patientDetails.sidebar.prescriptionsTitle')}</h4>
                            </div>
                            <button 
                                onClick={() => setIsPrescriptionModalOpen(true)}
                                className="w-7 h-7 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                        <div className="p-4">
                            {historyLoading ? (
                                <div className="space-y-2 py-4">
                                    <div className="h-10 bg-ice-50 animate-pulse rounded-lg" />
                                    <div className="h-10 bg-ice-50 animate-pulse rounded-lg" />
                                </div>
                            ) : prescriptions.length === 0 ? (
                                <div className="p-4 text-center space-y-3">
                                    <div className="w-10 h-10 rounded-full bg-ice-50 flex items-center justify-center mx-auto">
                                        <FileText size={16} className="text-ice-200" />
                                    </div>
                                    <p className="text-[10px] text-graphite-400 font-medium tracking-tight">{t('patientDetails.sidebar.prescriptionsEmpty')}</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {prescriptions.map((presc) => (
                                        <div key={presc.id} className="p-3 bg-ice-50/50 hover:bg-white border border-transparent hover:border-ice-100 rounded-xl flex items-center justify-between group transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-primary shadow-sm border border-ice-100">
                                                    <Pill size={14} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-black text-graphite-900 leading-tight truncate">
                                                        {prescriptionSummary(presc.content_json) || t('patientDetails.sidebar.prescriptionName')}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {formatDate(presc.created_at)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => {
                                                        setSelectedPrescription(presc);
                                                        setIsViewPrescriptionOpen(true);
                                                    }}
                                                    title={t('patientDetails.sidebar.view')}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-brand-primary transition-all cursor-pointer"
                                                >
                                                    <Eye size={12} />
                                                </button>
                                                <button
                                                    onClick={() => handleReissuePrescription(presc)}
                                                    title={t('patientDetails.sidebar.reissue')}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-emerald-600 transition-all cursor-pointer"
                                                >
                                                    <RefreshCw size={12} />
                                                </button>
                                                <button
                                                    onClick={() => setVoidTarget({ type: 'prescription', id: presc.id, label: prescriptionSummary(presc.content_json) || t('patientDetails.sidebar.prescriptionName') })}
                                                    title={t('patientDetails.sidebar.void')}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-rose-500 transition-all cursor-pointer"
                                                >
                                                    <Ban size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Financiamento Status */}
                    <div className="bg-white rounded-2xl border border-ice-200 overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                            <div className="flex items-center gap-2">
                                <Wallet size={18} className="text-emerald-500" />
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">{t('patientDetails.sidebar.financingTitle')}</h4>
                            </div>
                        </div>
                        <div className="p-4">
                            {historyLoading ? (
                                <div className="h-12 bg-ice-50 animate-pulse rounded-lg" />
                            ) : financingProposals.length === 0 ? (
                                <div className="p-4 text-center border-2 border-dashed border-ice-100 rounded-xl">
                                    <p className="text-[10px] text-graphite-400 font-bold mb-3 uppercase tracking-tight">{t('patientDetails.sidebar.financingEmpty')}</p>
                                    <button
                                        onClick={() => setIsCheckoutModalOpen(true)}
                                        className="text-[10px] font-black text-brand-primary bg-brand-primary/5 px-4 py-2 rounded-lg hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"
                                    >
                                        {t('patientDetails.sidebar.financingViewOptions')}
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {financingProposals.map((prop) => (
                                        <div key={prop.id} className="p-4 rounded-xl border border-ice-100 bg-white shadow-sm relative overflow-hidden group">
                                            <div className={`absolute left-0 top-0 w-1 h-full ${
                                                prop.status === 'APPROVED' ? 'bg-emerald-500' :
                                                prop.status === 'SIGNED' ? 'bg-brand-primary' :
                                                'bg-amber-400'
                                            }`} />
                                            
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="text-xs font-black text-graphite-900">{prop.installments}x {formatMoney(prop.amount)}</p>
                                                    <p className="text-[9px] font-bold text-graphite-400 uppercase tracking-widest">{prop.provider}</p>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                                    prop.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600' :
                                                    prop.status === 'SIGNED' ? 'bg-emerald-500 text-white' :
                                                    prop.status === 'PENDING' ? 'bg-amber-50 text-amber-600' :
                                                    'bg-ice-100 text-graphite-400'
                                                }`}>
                                                    {prop.status}
                                                </span>
                                            </div>

                                            {prop.external_link && prop.status === 'PENDING' && (
                                                <a 
                                                    href={prop.external_link} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="block w-full text-center py-2 bg-emerald-500 text-white rounded-lg text-[10px] font-black hover:bg-emerald-600 transition-all no-underline"
                                                >
                                                    {t('patientDetails.sidebar.resendSignatureLink')}
                                                </a>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Exames */}
                    <div className="bg-white rounded-2xl border border-ice-200 overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                            <div className="flex items-center gap-2">
                                <FlaskConical size={18} className="text-emerald-500" />
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">{t('patientDetails.sidebar.examsTitle')}</h4>
                            </div>
                            <button 
                                onClick={() => setIsExamModalOpen(true)}
                                className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all border-none cursor-pointer"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                        <div className="p-4">
                            {historyLoading ? (
                                <div className="space-y-2 py-4">
                                    <div className="h-10 bg-ice-50 animate-pulse rounded-lg" />
                                    <div className="h-10 bg-ice-50 animate-pulse rounded-lg" />
                                </div>
                            ) : exams.length === 0 ? (
                                <div className="p-4 text-center space-y-3">
                                    <div className="w-10 h-10 rounded-full bg-ice-50 flex items-center justify-center mx-auto">
                                        <Activity size={16} className="text-ice-200" />
                                    </div>
                                    <p className="text-[10px] text-graphite-400 font-medium tracking-tight">{t('patientDetails.sidebar.examsEmpty')}</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {exams.map((exam) => (
                                        <div key={exam.id} className="p-3 bg-ice-50/50 hover:bg-white border border-transparent hover:border-ice-100 rounded-xl flex items-center justify-between group transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-emerald-500 shadow-sm border border-ice-100">
                                                    <FlaskConical size={14} />
                                                </div>
                                                <div className="min-w-0 flex-1" title={exam.filename}>
                                                    <p className="text-[11px] font-black text-graphite-900 leading-tight truncate">{exam.filename}</p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {formatDate(exam.created_at)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => setPreviewDoc(exam)}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-emerald-500 transition-all cursor-pointer"
                                                    title={t('documentPreviewModal.title')}
                                                >
                                                    <Eye size={12} />
                                                </button>
                                                <button
                                                    onClick={() => { setReplacingExam({ id: exam.id, version: exam.version || 1, filename: exam.filename }); setIsExamModalOpen(true); }}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-indigo-600 transition-all cursor-pointer"
                                                    title={t('patientDetails.sidebar.replace')}
                                                >
                                                    <RefreshCw size={12} />
                                                </button>
                                                <button
                                                    onClick={() => setVoidTarget({ type: 'document', id: exam.id, label: exam.filename })}
                                                    className="p-1.5 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-rose-500 transition-all cursor-pointer"
                                                    title={t('patientDetails.sidebar.delete')}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Dental Budgets (Only for Dental Specialty) */}
                    {tenant?.specialty?.includes('dental') && (
                        <div className="bg-white rounded-2xl border border-ice-200 overflow-hidden shadow-sm">
                            <div className="p-5 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                                <div className="flex items-center gap-2">
                                    <Calculator size={18} className="text-emerald-600" />
                                    <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">{t('patientDetails.sidebar.dentalBudgetsTitle')}</h4>
                                </div>
                            </div>
                            <div className="p-4">
                                <div className="space-y-3">
                                    {dentalBudgets.length === 0 ? (
                                        <p className="text-xs text-graphite-400 font-medium text-center py-4">{t('patientDetails.sidebar.dentalBudgetsEmpty')}</p>
                                    ) : (
                                        dentalBudgets.map((budget: any) => (
                                            <div key={budget.id} className="p-4 rounded-xl border border-ice-100 bg-ice-50/30 flex items-center justify-between">
                                                <div>
                                                    <p className="text-xs font-black text-graphite-900">{budget.notes || t('patientDetails.sidebar.dentalBudgetFallbackName')}</p>
                                                    <p className="text-[10px] font-bold text-graphite-400 uppercase">{t(`dentalBudgetStatus.${budget.status}`, { defaultValue: budget.status })}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs font-black text-emerald-600">
                                                        {formatMoney(budget.total_amount)}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {formatDate(budget.created_at)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <NewMedicalRecordModal
                key={amendingRecord?.id ?? 'new'}
                isOpen={isRecordModalOpen}
                onClose={() => { setIsRecordModalOpen(false); setAmendingRecord(null); }}
                onSuccess={() => { fetchPatientData(); fetchMedicalRecords(); refreshTimeline(); }}
                patientId={patientId}
                patientCpf={patient?.cpf}
                amendingRecord={amendingRecord}
            />

            <NewPrescriptionModal
                isOpen={isPrescriptionModalOpen}
                onClose={() => setIsPrescriptionModalOpen(false)}
                onSuccess={() => { fetchHistoryData(); refreshTimeline(); }}
                patientId={patientId}
            />

            <UploadDocumentModal
                key={replacingExam?.id ?? 'new'}
                isOpen={isExamModalOpen}
                onClose={() => { setIsExamModalOpen(false); setReplacingExam(null); }}
                onSuccess={() => { fetchHistoryData(); refreshTimeline(); }}
                patientId={patientId}
                replacingDocument={replacingExam}
            />

            <ViewPrescriptionModal
                isOpen={isViewPrescriptionOpen}
                onClose={() => setIsViewPrescriptionOpen(false)}
                prescription={selectedPrescription}
            />

            <NewDentalBudgetModal
                isOpen={isBudgetModalOpen}
                onClose={() => setIsBudgetModalOpen(false)}
                onSuccess={() => { fetchHistoryData(); }}
                patientId={patientId}
            />

            <CheckoutModal 
                isOpen={isCheckoutModalOpen}
                onClose={() => { setIsCheckoutModalOpen(false); fetchHistoryData(); }}
                patientId={patientId}
                patientName={patient.full_name}
                initialAmount={dentalBudgets[0]?.total_amount || financingProposals[0]?.amount || 0}
                tenantId={tenant?.id || ''}
            />

            <DocumentPreviewModal
                isOpen={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                bucket="documents"
                filePath={previewDoc?.file_path}
                fileName={previewDoc?.filename || ''}
                fileType={previewDoc?.file_type}
            />

            <VoidReasonModal
                isOpen={!!voidTarget}
                onClose={() => setVoidTarget(null)}
                onConfirm={voidTarget?.type === 'document' ? handleDeleteExamConfirm : handleVoidConfirm}
                title={
                    voidTarget?.type === 'medical_record' ? t('patientDetails.voidModal.medicalRecordTitle')
                    : voidTarget?.type === 'prescription' ? t('patientDetails.voidModal.prescriptionTitle')
                    : t('patientDetails.voidModal.documentTitle')
                }
                description={t('patientDetails.voidModal.description', { label: voidTarget?.label || '' })}
                confirmLabel={voidTarget?.type === 'document' ? t('patientDetails.voidModal.confirmDelete') : t('patientDetails.voidModal.confirmVoid')}
            />
        </div>
    );
};

const SoapField = ({ label, text }: { label: string; text: string }) => (
    <div className="p-3 bg-ice-50/60 rounded-xl border border-ice-100">
        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{label}</p>
        <p className="text-sm text-graphite-700 leading-relaxed">{text}</p>
    </div>
);
