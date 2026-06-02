import React, { useEffect, useState } from 'react';
import { 
    Activity, 
    Calendar, 
    FileText, 
    Image as ImageIcon, 
    Plus, 
    ChevronRight,
    ArrowUpRight,
    Clock,
    ExternalLink
} from 'lucide-react';
import { motion } from 'framer-motion';
import { dentalService } from '../services/dentalService';
import { useToast } from '../contexts/ToastContext';
import { NewDentalBudgetModal } from '../components/dental/NewDentalBudgetModal';
import { DicomViewerModal } from '../components/dental/DicomViewerModal';
import { OdontogramModal } from '../components/dental/OdontogramModal';
import { PatientSearchModal } from '../components/shared/PatientSearchModal';

export const OdontologyHub: React.FC<{ activeView?: string }> = ({ activeView }) => {
    const { showToast } = useToast();
    const [budgets, setBudgets] = useState<any[]>([]);
    const [recalls, setRecalls] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Modal states
    const [isBudgetOpen, setIsBudgetOpen] = useState(false);
    const [isDicomOpen, setIsDicomOpen] = useState(false);
    const [isOdontogramOpen, setIsOdontogramOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    
    // Selection state
    const [selectedPatient, setSelectedPatient] = useState<any>(null);
    const [pendingAction, setPendingAction] = useState<'budget' | 'odontogram' | null>(null);

    useEffect(() => {
        if (activeView === 'odontogram') {
            handleActionRequest('odontogram');
        }
    }, [activeView]);

    useEffect(() => {
        const fetchHubData = async () => {
            try {
                setLoading(true);
                const [budgetData, recallData] = await Promise.all([
                    dentalService.getAllBudgets(),
                    dentalService.getRecalls()
                ]);
                setBudgets(budgetData || []);
                setRecalls(recallData || []);
            } catch (error: any) {
                showToast('error', 'Erro ao carregar dados do hub: ' + error.message);
            } finally {
                setLoading(false);
            }
        };
        fetchHubData();
    }, []);

    const handleActionRequest = (action: 'budget' | 'odontogram') => {
        setPendingAction(action);
        setIsSearchOpen(true);
    };

    const handleOpenIDocs = () => {
        if (!selectedPatient?.cpf) {
            showToast('warning', 'CPF do paciente é necessário para consulta no iDocs.');
            return;
        }
        window.open('https://s3.radiomemory.com.br/', '_blank');
        showToast('info', 'Abrindo exames no iDoc (Radio Memory)...');
    };

    const stats = [
        { label: 'Recalls este Mês', value: recalls.length.toString(), icon: Calendar, color: 'text-brand-primary', bg: 'bg-brand-primary/10' },
        { label: 'Orçamentos em Aberto', value: budgets.filter(b => b.status === 'draft' || b.status === 'sent').length.toString(), icon: FileText, color: 'text-blue-600', bg: 'bg-blue-100' },
        { label: 'Exames DICOM', value: '14', icon: ImageIcon, color: 'text-purple-600', bg: 'bg-purple-100', onClick: () => setIsDicomOpen(true) },
        { label: 'Mapa Clínico', value: '32 Dentes', icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-100', onClick: () => handleActionRequest('odontogram') },
    ];

    if (loading) return <div className="p-8 text-center font-bold text-graphite-400">Carregando Hub Odontológico...</div>;

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h2 className="text-4xl font-black text-graphite-900 tracking-tighter">Hub de Odontologia</h2>
                    <p className="text-graphite-400 font-medium italic">Gestão clínica, diagnósticos e planos de tratamento.</p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={() => setIsDicomOpen(true)}
                        className="px-6 py-3 bg-white border border-ice-200 text-graphite-900 rounded-2xl text-sm font-bold shadow-sm hover:bg-ice-50 transition-all border-none cursor-pointer flex items-center gap-2"
                    >
                        <ImageIcon size={18} className="text-brand-primary" />
                        Visualizador DICOM
                    </button>
                    <button 
                        onClick={handleOpenIDocs}
                        className="px-6 py-3 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl text-sm font-bold shadow-sm hover:bg-indigo-100 transition-all border-none cursor-pointer flex items-center gap-2"
                        title="Acessar exames no iDoc (Radio Memory)"
                    >
                        <ExternalLink size={18} />
                        iDocs
                    </button>
                    <button 
                        onClick={() => handleActionRequest('budget')}
                        className="px-6 py-3 bg-brand-primary text-white rounded-2xl text-sm font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] transition-all border-none cursor-pointer flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Novo Orçamento
                    </button>
                </div>
            </header>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, i) => (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        key={i}
                        onClick={stat.onClick}
                        className={`glass p-6 rounded-[32px] space-y-4 border border-ice-100/50 ${stat.onClick ? 'cursor-pointer hover:border-brand-primary/30' : ''}`}
                    >
                        <div className="flex justify-between items-start">
                            <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color}`}>
                                <stat.icon size={20} />
                            </div>
                            <div className="bg-emerald-100 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-full flex items-center gap-1">
                                <ArrowUpRight size={10} />
                                +12%
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{stat.label}</p>
                            <h3 className="text-2xl font-black text-graphite-900 tracking-tighter">{stat.value}</h3>
                        </div>
                    </motion.div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Recall List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xl font-black tracking-tight flex items-center gap-2 text-graphite-900">
                            <div className="w-2 h-2 bg-brand-primary rounded-full"></div>
                            Agenda de Prevenção (Recalls)
                        </h4>
                        <button className="text-xs font-bold text-brand-primary hover:underline border-none bg-transparent cursor-pointer">Exportar Lista</button>
                    </div>

                    <div className="glass rounded-[32px] overflow-hidden border-none">
                        <div className="p-2">
                            {recalls.map((recall, i) => (
                                <div key={i} 
                                    onClick={() => {
                                        setSelectedPatient(recall);
                                        setIsOdontogramOpen(true);
                                    }}
                                    className="flex items-center justify-between p-5 hover:bg-ice-50/50 rounded-2xl transition-all group cursor-pointer"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center border border-ice-100 font-black text-brand-primary shadow-sm group-hover:bg-brand-primary group-hover:text-white transition-all">
                                            {recall.full_name?.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-graphite-900">{recall.full_name}</p>
                                            <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest">{recall.recall_reason}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right hidden sm:block">
                                            <p className="text-xs font-black text-graphite-900">{recall.due_date}</p>
                                            <p className="text-[10px] text-brand-primary font-bold">Vencido</p>
                                        </div>
                                        <div className="w-10 h-10 rounded-xl bg-ice-50 flex items-center justify-center text-graphite-400 group-hover:bg-brand-primary/10 group-hover:text-brand-primary transition-all">
                                            <ChevronRight size={18} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Recent Budgets */}
                <div className="space-y-6">
                    <h4 className="text-xl font-black tracking-tight text-graphite-900">Últimos Orçamentos</h4>
                    <div className="space-y-4">
                        {budgets.map((budget, i) => (
                            <div key={i} className="glass p-5 rounded-3xl space-y-3 cursor-pointer group hover:border-brand-primary/30 transition-all border-ice-100">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <p className="text-sm font-black text-graphite-900 truncate w-32">{budget.patients?.full_name}</p>
                                        <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                            <Clock size={10} />
                                            {new Date(budget.created_at || '').toLocaleDateString()}
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                                        budget.status === 'approved' ? 'bg-emerald-100 text-emerald-600' : 
                                        budget.status === 'draft' ? 'bg-ice-100 text-graphite-400' : 'bg-blue-100 text-blue-600'
                                    }`}>
                                        {budget.status}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">Total</span>
                                    <span className="text-sm font-black text-graphite-900 text-brand-primary">R$ {budget.total_amount?.toLocaleString()}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Feature Modals */}
            <PatientSearchModal 
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                title={pendingAction === 'budget' ? 'Criar Orçamento para...' : 'Ver Odontograma de...'}
                specialty="dental"
                onSelect={(patient) => {
                    setSelectedPatient(patient);
                    setIsSearchOpen(false);
                    if (pendingAction === 'budget') setIsBudgetOpen(true);
                    else setIsOdontogramOpen(true);
                }}
            />

            <NewDentalBudgetModal 
                isOpen={isBudgetOpen}
                onClose={() => setIsBudgetOpen(false)}
                patientId={selectedPatient?.id}
                onSuccess={() => {
                    setIsBudgetOpen(false);
                    showToast('success', 'Orçamento criado com sucesso!');
                }}
            />

            <DicomViewerModal 
                isOpen={isDicomOpen}
                onClose={() => setIsDicomOpen(false)}
            />

            <OdontogramModal 
                isOpen={isOdontogramOpen}
                onClose={() => setIsOdontogramOpen(false)}
                patientId={selectedPatient?.id}
                patientName={selectedPatient?.full_name}
                patientCpf={selectedPatient?.cpf}
            />
        </div>
    );
};
