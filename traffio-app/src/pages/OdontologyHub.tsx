import React, { useEffect, useState } from 'react';
import {
    Activity,
    Calendar,
    FileText,
    Image as ImageIcon,
    Plus,
    ChevronRight,
    Clock,
    ExternalLink,
    Stethoscope,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dentalService } from '../services/dentalService';
import { useToast } from '../contexts/ToastContext';
import { NewDentalBudgetModal } from '../components/dental/NewDentalBudgetModal';
import { DicomViewerModal } from '../components/dental/DicomViewerModal';
import { OdontogramModal } from '../components/dental/OdontogramModal';
import { PatientSearchModal } from '../components/shared/PatientSearchModal';
import { Button, Badge, KpiCard, Card, PageHeader, EmptyState } from '../components/ui';

export const OdontologyHub: React.FC<{ activeView?: string }> = ({ activeView }) => {
    const { t } = useTranslation('medical');
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
                showToast('error', t('odontologyHub.toasts.loadError') + error.message);
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
            showToast('warning', t('odontologyHub.toasts.cpfRequired'));
            return;
        }
        window.open('https://s3.radiomemory.com.br/', '_blank');
        showToast('info', t('odontologyHub.toasts.opening'));
    };

    const stats = [
        { label: t('odontologyHub.stats.recallsThisMonth'), value: recalls.length.toString(), icon: Calendar, accent: 'brand' as const },
        { label: t('odontologyHub.stats.openBudgets'), value: budgets.filter(b => b.status === 'draft' || b.status === 'sent').length.toString(), icon: FileText, accent: 'info' as const },
        { label: t('odontologyHub.stats.dicomExams'), value: '14', icon: ImageIcon, accent: 'purple' as const, onClick: () => setIsDicomOpen(true) },
        { label: t('odontologyHub.stats.clinicalMap'), value: t('odontologyHub.stats.clinicalMapValue'), icon: Activity, accent: 'success' as const, onClick: () => handleActionRequest('odontogram') },
    ];

    if (loading) return <div className="p-8 text-center font-bold text-graphite-400">{t('odontologyHub.loading')}</div>;

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <PageHeader
                icon={Stethoscope}
                size="large"
                title={t('odontologyHub.title')}
                subtitle={<span className="italic">{t('odontologyHub.subtitle')}</span>}
                actions={
                    <>
                        <Button variant="ghost" onClick={() => setIsDicomOpen(true)}>
                            <ImageIcon size={18} className="text-brand-primary" />
                            {t('odontologyHub.dicomViewerButton')}
                        </Button>
                        <Button variant="secondary" onClick={handleOpenIDocs} title={t('odontologyHub.idocsTitle')}>
                            <ExternalLink size={18} />
                            iDocs
                        </Button>
                        <Button variant="primary" onClick={() => handleActionRequest('budget')}>
                            <Plus size={18} />
                            {t('odontologyHub.newBudget')}
                        </Button>
                    </>
                }
            />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {stats.map((stat, i) => (
                    <KpiCard
                        key={i}
                        variant="glass"
                        label={stat.label}
                        value={stat.value}
                        icon={stat.icon}
                        accent={stat.accent}
                        onClick={stat.onClick}
                    />
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Recall List */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xl font-black tracking-tight flex items-center gap-2 text-graphite-900">
                            <div className="w-2 h-2 bg-brand-primary rounded-full"></div>
                            {t('odontologyHub.recallsTitle')}
                        </h4>
                        <button className="text-xs font-bold text-brand-primary hover:underline border-none bg-transparent cursor-pointer">{t('odontologyHub.exportList')}</button>
                    </div>

                    <Card variant="glass" padding="none" className="overflow-hidden">
                        {recalls.length === 0 ? (
                            <EmptyState icon={Calendar} label={t('odontologyHub.emptyRecalls')} className="border-none bg-transparent" />
                        ) : (
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
                                            <p className="text-[10px] text-brand-primary font-bold">{t('odontologyHub.overdue')}</p>
                                        </div>
                                        <div className="w-10 h-10 rounded-xl bg-ice-50 flex items-center justify-center text-graphite-400 group-hover:bg-brand-primary/10 group-hover:text-brand-primary transition-all">
                                            <ChevronRight size={18} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        )}
                    </Card>
                </div>

                {/* Recent Budgets */}
                <div className="space-y-6">
                    <h4 className="text-xl font-black tracking-tight text-graphite-900">{t('odontologyHub.recentBudgets')}</h4>
                    <div className="space-y-4">
                        {budgets.length === 0 && (
                            <EmptyState icon={FileText} label={t('odontologyHub.emptyBudgets')} />
                        )}
                        {budgets.map((budget, i) => (
                            <Card key={i} variant="glass" padding="md" className="cursor-pointer">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <p className="text-sm font-black text-graphite-900 truncate w-32">{budget.patients?.full_name}</p>
                                        <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                            <Clock size={10} />
                                            {new Date(budget.created_at || '').toLocaleDateString()}
                                        </p>
                                    </div>
                                    <Badge size="sm" accent={budget.status === 'approved' ? 'success' : budget.status === 'draft' ? 'neutral' : 'info'}>
                                        {budget.status}
                                    </Badge>
                                </div>
                                <div className="flex justify-between items-center pt-2 mt-3 border-t border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">{t('odontologyHub.total')}</span>
                                    <span className="text-sm font-black text-graphite-900 text-brand-primary">R$ {budget.total_amount?.toLocaleString()}</span>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            </div>

            {/* Feature Modals */}
            <PatientSearchModal 
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                title={pendingAction === 'budget' ? t('odontologyHub.searchModal.budgetTitle') : t('odontologyHub.searchModal.odontogramTitle')}
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
                    showToast('success', t('odontologyHub.toasts.budgetCreated'));
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
