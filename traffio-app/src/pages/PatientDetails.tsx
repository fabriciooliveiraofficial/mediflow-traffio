import React, { useEffect, useState } from 'react';
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
    TrendingUp,
    Wallet,
    ExternalLink
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
import { DicomViewer } from '../components/dental/DicomViewer';
import { AnthropometryForm } from '../components/nutrition/AnthropometryForm';
import { CheckoutModal } from '../components/CheckoutModal';
import { dentalService } from '../services/dentalService';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { formatDisplayDate } from '../lib/dateUtils';

interface PatientDetailsProps {
    patientId: string;
    onBack: () => void;
}

export const PatientDetails: React.FC<PatientDetailsProps> = ({ patientId, onBack }) => {
    const { tenant } = useTenant();
    const [activeTab, setActiveTab] = useState<'timeline' | 'medical-record' | 'dental' | 'exams' | 'nutrition'>('timeline');
    const [patient, setPatient] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
    const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
    const [isExamModalOpen, setIsExamModalOpen] = useState(false);
    const [isViewPrescriptionOpen, setIsViewPrescriptionOpen] = useState(false);
    const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
    const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
    const [dentalBudgets, setDentalBudgets] = useState<any[]>([]);
    const [selectedPrescription, setSelectedPrescription] = useState<any>(null);
    const [explainTerm, setExplainTerm] = useState<string | null>(null);
    const [prescriptions, setPrescriptions] = useState<any[]>([]);
    const [exams, setExams] = useState<any[]>([]);
    const [financingProposals, setFinancingProposals] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);

    const { showToast } = useToast();
    const { events: timelineEvents, loading: timelineLoading, refresh: refreshTimeline } = usePatientTimeline(patientId);

    useEffect(() => {
        fetchPatientData();
    }, [patientId]);

    useEffect(() => {
        if (activeTab !== 'timeline') {
            fetchHistoryData();
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
            
            // Fetch Prescriptions
            const { data: prescriptionsData } = await supabase
                .from('prescriptions')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });

            setPrescriptions(prescriptionsData || []);

            // Fetch Exams
            const { data: examsData } = await supabase
                .from('documents')
                .select('*')
                .eq('patient_id', patientId)
                .eq('category', 'exam_result')
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
            showToast('error', 'Erro ao carregar histórico: ' + error.message);
        } finally {
            setHistoryLoading(false);
        }
    };

    const handleOpenIDocs = () => {
        if (!patient?.cpf) {
            showToast('warning', 'CPF do paciente é necessário para consulta no iDocs.');
            return;
        }
        window.open('https://s3.radiomemory.com.br/', '_blank');
        showToast('info', 'Abrindo exames no iDoc (Radio Memory)...');
    };

    if (loading) {
        return <div className="p-12 text-center text-graphite-400 font-medium">Carregando prontuário...</div>;
    }

    if (!patient) {
        return <div className="p-12 text-center text-accent-error font-medium">Paciente não encontrado.</div>;
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
                    <span>Voltar para Lista</span>
                </button>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCheckoutModalOpen(true)}
                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-500/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <Wallet size={18} />
                        <span>Nova Proposta Financeira</span>
                    </button>
                    <button
                        onClick={() => setIsRecordModalOpen(true)}
                        className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <Plus size={18} />
                        <span>Nova Evolução</span>
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
                            Ativo
                        </span>
                        {patient.last_visit_at && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-lg border border-amber-100 mt-2">
                                <History size={10} className="text-amber-600" />
                                <span className="text-[9px] font-black text-amber-700 uppercase">
                                    Recall: {new Date(patient.last_visit_at).toLocaleDateString('pt-BR')}
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
                                        {patient.insurance_provider || 'Convênio'}
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-[10px] font-black uppercase border border-amber-200">
                                        Particular
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-graphite-500 font-medium">
                                <span className="flex items-center gap-2">
                                    <FileText size={16} className="text-brand-primary" />
                                    CPF: {patient.cpf || 'Não informado'}
                                </span>
                                <span className="flex items-center gap-2">
                                    <Calendar size={16} className="text-brand-primary" />
                                    Nasc: {formatDisplayDate(patient.birth_date) || '--/--/----'}
                                </span>
                                {patient.insurance_card && (
                                    <span className="flex items-center gap-2">
                                        <ShieldCheck size={16} className="text-emerald-500" />
                                        Cartão: {patient.insurance_card}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl bg-ice-50 border border-ice-100 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand-primary shadow-sm">
                                    <Phone size={20} />
                                </div>
                                <div>
                                    <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">Celular</p>
                                    <p className="font-bold text-graphite-900">{patient.mobile || 'Não cadastrado'}</p>
                                </div>
                            </div>
                            <div className="p-4 rounded-2xl bg-ice-50 border border-ice-100 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand-primary shadow-sm">
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">Email</p>
                                    <p className="font-bold text-graphite-900">{patient.email || 'Não cadastrado'}</p>
                                </div>
                            </div>
                        </div>
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
                    LINHA DO TEMPO
                </button>
                <button
                    onClick={() => setActiveTab('medical-record')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'medical-record' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-400 hover:text-graphite-600'}`}
                >
                    <Stethoscope size={14} />
                    PRONTUÁRIO
                </button>
                {tenant?.specialty?.includes('dental') && (
                    <button
                        onClick={() => setActiveTab('dental')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'dental' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-graphite-400 hover:text-emerald-500'}`}
                    >
                        <DentalIcon size={14} />
                        ODONTOLOGIA
                    </button>
                )}
                <button
                    onClick={() => setActiveTab('exams')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'exams' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-graphite-400 hover:text-indigo-600'}`}
                >
                    <Scan size={14} />
                    EXAMES
                </button>
                {tenant?.specialty?.includes('nutrition') && (
                    <button
                        onClick={() => setActiveTab('nutrition')}
                        className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'nutrition' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-graphite-400 hover:text-indigo-600'}`}
                    >
                        <Apple size={14} />
                        NUTRIÇÃO
                    </button>
                )}
            </div>

            {/* Content Tabs / Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Timeline / Specialized Views */}
                <div className="lg:col-span-2 space-y-6">
                    {activeTab === 'timeline' && (
                        <>
                            <div className="flex items-center gap-3 mb-4">
                                <Activity className="text-brand-primary" />
                                <h3 className="text-xl font-black text-graphite-900">Linha do Tempo Clínica</h3>
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
                                        <p>Nenhum registro clínico encontrado.</p>
                                        <p className="text-sm">Inicie uma nova evolução para registrar o atendimento.</p>
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

                    {activeTab === 'medical-record' && (
                        <div className="bg-white border border-ice-100 rounded-[32px] p-12 text-center space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                             <div className="w-20 h-20 rounded-full bg-ice-50 flex items-center justify-center mx-auto text-brand-primary">
                                <FileText size={40} />
                            </div>
                            <h3 className="text-xl font-black text-graphite-900">Histórico de Prontuário</h3>
                            <p className="text-sm text-graphite-500 max-w-xs mx-auto">Visualize todas as evoluções clínicas em formato de documento contínuo.</p>
                        </div>
                    )}

                    {activeTab === 'dental' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                            <div className="flex items-center justify-between bg-emerald-500/10 p-6 rounded-[32px] border border-emerald-500/20">
                                <div>
                                    <h3 className="text-xl font-black text-emerald-800">Mapa Odontológico</h3>
                                    <p className="text-sm text-emerald-700 font-medium">Clique nas faces dos dentes para registrar diagnósticos ou gerar orçamentos.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={handleOpenIDocs}
                                        className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-600 px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-indigo-100 transition-all cursor-pointer"
                                        title="Acessar exames no iDoc (Radio Memory)"
                                    >
                                        <ExternalLink size={18} />
                                        <span>iDocs</span>
                                    </button>
                                    <button 
                                        onClick={() => setIsBudgetModalOpen(true)}
                                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-500/20 hover:scale-105 transition-transform border-none cursor-pointer"
                                    >
                                        <Calculator size={18} />
                                        <span>Gerar Plano de Tratamento</span>
                                    </button>
                                </div>
                            </div>
                            <Odontogram patientId={patientId} />
                        </div>
                    )}

                    {activeTab === 'exams' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                             <DicomViewer fileUrl="mock" />
                        </div>
                    )}

                    {activeTab === 'nutrition' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                            <div className="flex justify-between items-center bg-indigo-600 p-6 rounded-[32px] text-white shadow-xl shadow-indigo-600/10">
                                <div>
                                    <h3 className="text-xl font-black">Módulo Nutricional</h3>
                                    <p className="text-sm opacity-80 font-medium">Avaliação Antropométrica e Composição Corporal</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button className="flex items-center gap-2 bg-white/20 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-white/30 transition-all border-none cursor-pointer">
                                        <TrendingUp size={18} />
                                        <span>Evolução</span>
                                    </button>
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
                        <AIExplainButton term={explainTerm} />
                    )}
                </div>

                {/* Right Column: Quick Info */}
                <div className="space-y-6">
                    {/* Receitas */}
                    <div className="bg-white rounded-2xl border border-ice-200 overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                            <div className="flex items-center gap-2">
                                <ClipboardList size={18} className="text-brand-primary" />
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">Histórico de Receitas</h4>
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
                                    <p className="text-[10px] text-graphite-400 font-medium tracking-tight">Nenhuma receita emitida recentemente.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {prescriptions.map((presc) => (
                                        <div key={presc.id} className="p-3 bg-ice-50/50 hover:bg-white border border-transparent hover:border-ice-100 rounded-xl flex items-center justify-between group transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-primary shadow-sm border border-ice-100">
                                                    <Pill size={14} />
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-black text-graphite-900 leading-tight">Receita Médica</p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {new Date(presc.created_at).toLocaleDateString('pt-BR')}
                                                    </p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    setSelectedPrescription(presc);
                                                    setIsViewPrescriptionOpen(true);
                                                }}
                                                className="p-1.5 opacity-0 group-hover:opacity-100 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-brand-primary transition-all cursor-pointer"
                                            >
                                                <FileText size={12} />
                                            </button>
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
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">Crédito & Parcelamento</h4>
                            </div>
                        </div>
                        <div className="p-4">
                            {historyLoading ? (
                                <div className="h-12 bg-ice-50 animate-pulse rounded-lg" />
                            ) : financingProposals.length === 0 ? (
                                <div className="p-4 text-center border-2 border-dashed border-ice-100 rounded-xl">
                                    <p className="text-[10px] text-graphite-400 font-bold mb-3 uppercase tracking-tight">Sem propostas ativas</p>
                                    <button 
                                        onClick={() => setIsCheckoutModalOpen(true)}
                                        className="text-[10px] font-black text-brand-primary bg-brand-primary/5 px-4 py-2 rounded-lg hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"
                                    >
                                        VER OPÇÕES DE CRÉDITO
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
                                                    <p className="text-xs font-black text-graphite-900">{prop.installments}x {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prop.amount)}</p>
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
                                                    REENVIAR LINK DE ASSINATURA
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
                                <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">Resultados de Exames</h4>
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
                                    <p className="text-[10px] text-graphite-400 font-medium tracking-tight">Aguardando anexos de laboratório.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {exams.map((exam) => (
                                        <div key={exam.id} className="p-3 bg-ice-50/50 hover:bg-white border border-transparent hover:border-ice-100 rounded-xl flex items-center justify-between group transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-emerald-500 shadow-sm border border-ice-100">
                                                    <FlaskConical size={14} />
                                                </div>
                                                <div className="max-w-[120px]">
                                                    <p className="text-[11px] font-black text-graphite-900 leading-tight truncate">{exam.filename}</p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {new Date(exam.created_at).toLocaleDateString('pt-BR')}
                                                    </p>
                                                </div>
                                            </div>
                                            <a 
                                                href={exam.file_url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="p-1.5 opacity-0 group-hover:opacity-100 bg-white border border-ice-200 rounded-lg text-graphite-400 hover:text-emerald-500 transition-all cursor-pointer"
                                            >
                                                <FileText size={12} />
                                            </a>
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
                                    <h4 className="font-black text-xs text-graphite-900 uppercase tracking-wider">Planos de Tratamento</h4>
                                </div>
                            </div>
                            <div className="p-4">
                                <div className="space-y-3">
                                    {dentalBudgets.length === 0 ? (
                                        <p className="text-xs text-graphite-400 font-medium text-center py-4">Nenhum orçamento gerado.</p>
                                    ) : (
                                        dentalBudgets.map((budget: any) => (
                                            <div key={budget.id} className="p-4 rounded-xl border border-ice-100 bg-ice-50/30 flex items-center justify-between group hover:border-emerald-200 transition-all cursor-pointer">
                                                <div>
                                                    <p className="text-xs font-black text-graphite-900">{budget.description || 'Plano de Tratamento'}</p>
                                                    <p className="text-[10px] font-bold text-graphite-400 uppercase">{budget.status}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs font-black text-emerald-600">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(budget.total_amount)}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-graphite-400">
                                                        {new Date(budget.created_at).toLocaleDateString('pt-BR')}
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
                isOpen={isRecordModalOpen}
                onClose={() => setIsRecordModalOpen(false)}
                onSuccess={() => { fetchPatientData(); refreshTimeline(); }}
                patientId={patientId}
                patientCpf={patient?.cpf}
            />

            <NewPrescriptionModal
                isOpen={isPrescriptionModalOpen}
                onClose={() => setIsPrescriptionModalOpen(false)}
                onSuccess={() => { fetchHistoryData(); refreshTimeline(); }}
                patientId={patientId}
            />

            <UploadDocumentModal
                isOpen={isExamModalOpen}
                onClose={() => setIsExamModalOpen(false)}
                onSuccess={() => { fetchHistoryData(); }}
                patientId={patientId}
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
                initialAmount={2500} // Mock amount or pull from last budget
                tenantId={tenant?.id || ''}
            />
        </div>
    );
};
