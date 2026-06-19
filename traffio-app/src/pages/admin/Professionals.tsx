import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import {
    UserPlus,
    Stethoscope,
    Search,
    Trash2,
    Save,
    X,
    Shield,
    AlertCircle,
    CheckCircle2,
    Pencil,
    ToggleLeft,
    ToggleRight,
    Phone,
    Mail,
    ArrowLeft,
    ArrowRight,
    Check,
    Clock,
    Star,
    Bot,
    Plus,
    Sparkles,
} from 'lucide-react';
import { professionalService, type Professional } from '../../services/professionalService';
import { locationService, type ClinicLocation as Location } from '../../services/locationService';
import { insurancePlanService, type InsurancePlan, type DoctorInsurancePlan } from '../../services/insurancePlanService';

export interface BotProfile {
    pitch: string;
    selling_points: string[];
    objection_scripts: { preco: string; tempo: string; urgencia: string; [key: string]: string };
    faq: { q: string; a: string }[];
    pre_appointment_tip: string;
    consultation_opening: string;
}

const EMPTY_BOT_PROFILE: BotProfile = {
    pitch: '',
    selling_points: [''],
    objection_scripts: { preco: '', tempo: '', urgencia: '' },
    faq: [{ q: '', a: '' }],
    pre_appointment_tip: '',
    consultation_opening: '',
};

const EMPTY_FORM = {
    full_name: '',
    email: '',
    phone: '',
    role: 'doctor',
    specialty: '',
    crm: '',
    bio: '',
    rqe: '',
    color: '#1152d4',
    cancellation_policy: {
        enabled: false,
        free_window_hours: 24,
        late_penalty_percent: 0,
        no_show_penalty_percent: 100,
    }
};

// --- GRID CONSTANTS ---
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 07 to 19
type CellType = { type: 'prime' | 'regular' | 'blocked'; location_id: string | null } | null;
type ToolType = 'prime' | 'regular' | 'blocked' | 'eraser';

interface ScheduleBlock {
    id?: string;
    doctor_id: string;
    tenant_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    location_id: string | null;
    block_type: 'prime' | 'regular' | 'blocked';
}

export const Professionals = () => {
    const { t } = useTranslation('tenantAdmin');
    const DAYS = [
        t('professionals.days.sunday'),
        t('professionals.days.monday'),
        t('professionals.days.tuesday'),
        t('professionals.days.wednesday'),
        t('professionals.days.thursday'),
        t('professionals.days.friday'),
        t('professionals.days.saturday'),
    ];
    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [tenantId, setTenantId] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    // Detail panel state
    const [selectedPro, setSelectedPro] = useState<Professional | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const [detailTab, setDetailTab] = useState<'dados' | 'agenda' | 'convenios' | 'bot'>('dados');
    const [botProfile, setBotProfile] = useState<BotProfile>(EMPTY_BOT_PROFILE);
    const [savingBot, setSavingBot] = useState(false);

    // Schedule blocks state
    const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
    const [locations, setLocations] = useState<Location[]>([]);
    const [activeLocationId, setActiveLocationId] = useState<string | null>(null);


    // Insurance plans state
    const [allPlans, setAllPlans] = useState<InsurancePlan[]>([]);
    const [doctorPlans, setDoctorPlans] = useState<DoctorInsurancePlan[]>([]);

    // Grid state
    const [gridState, setGridState] = useState<Record<number, Record<number, CellType>>>({}); // day -> hour -> {type, locId}
    const [selectedTool, setSelectedTool] = useState<ToolType>('prime');
    const [isMouseDown, setIsMouseDown] = useState(false);

    // Load blocks into grid when blocks change
    useEffect(() => {
        if (scheduleBlocks.length > 0) {
            const newGrid: Record<number, Record<number, CellType>> = {};
            scheduleBlocks.forEach((b: any) => {
                const startH = parseInt(b.start_time.split(':')[0]);
                const endH = parseInt(b.end_time.split(':')[0]);
                for (let h = startH; h < endH; h++) {
                    if (!newGrid[b.day_of_week]) newGrid[b.day_of_week] = {};
                    newGrid[b.day_of_week][h] = { type: b.block_type, location_id: b.location_id };
                }
            });
            setGridState(newGrid);
        } else {
            setGridState({});
        }
    }, [scheduleBlocks]);

    const handlePaint = (day: number, hour: number) => {
        // Validation: If a location is selected, check its operating hours
        if (activeLocationId && selectedTool !== 'eraser') {
            const loc = locations.find(l => l.id === activeLocationId);
            if (loc?.operating_hours) {
                // Safer access for JSON keys (could be string "1" or number 1)
                const oh = loc.operating_hours[day] || (loc.operating_hours as any)[day.toString()];

                // Rule: If the unit has operating_hours defined, but this day is missing or explicitly marked 'Fechado', block the whole day.
                if (!oh || oh.closed) {
                    setError(`O local ${loc.name} está FECHADO neste dia.`);
                    return;
                } else {
                    const startH = parseInt(oh.start.split(':')[0]);
                    const endH = parseInt(oh.end.split(':')[0]);

                    if (hour < startH || hour >= endH) {
                        setError(`Neste dia, o local ${loc.name} funciona apenas das ${oh.start} às ${oh.end}.`);
                        return;
                    }
                }
            }
        }

        setGridState(prev => {
            const newState = { ...prev };
            newState[day] = { ...(prev[day] || {}) }; // Deep clone to avoid mutation

            if (selectedTool === 'eraser') {
                delete newState[day][hour];
            } else {
                newState[day][hour] = { type: selectedTool as any, location_id: activeLocationId };
            }
            return newState;
        });
    };

    const saveGridToDB = async () => {
        if (!selectedPro?.id || !tenantId) return;

        // 1. Convert Grid to Blocks (Compressor)
        const newBlocks: any[] = [];

        // Iterate days 0 (Dom) to 6 (Sab)
        for (let d = 0; d <= 6; d++) {
            const dayOfWeek = d;
            const dayHours = gridState[dayOfWeek] || {};

            let currentBlock: { start: number, end: number, type: 'prime' | 'regular' | 'blocked', locId: string | null } | null = null;

            for (let h = 7; h <= 19; h++) {
                const cell = dayHours[h];

                if (currentBlock) {
                    if (cell && cell.type === currentBlock.type && cell.location_id === currentBlock.locId) {
                        // Extend current
                        currentBlock.end = h + 1;
                    } else {
                        // Close current, push
                        newBlocks.push({
                            doctor_id: selectedPro.id,
                            tenant_id: tenantId,
                            day_of_week: dayOfWeek,
                            start_time: `${currentBlock.start.toString().padStart(2, '0')}:00`,
                            end_time: `${currentBlock.end.toString().padStart(2, '0')}:00`,
                            block_type: currentBlock.type,
                            location_id: currentBlock.locId
                        });
                        currentBlock = null;
                        // Start new if valid
                        if (cell) {
                            currentBlock = { start: h, end: h + 1, type: cell.type, locId: cell.location_id };
                        }
                    }
                } else {
                    if (cell) {
                        currentBlock = { start: h, end: h + 1, type: cell.type, locId: cell.location_id };
                    }
                }
            }
            // Close trailing
            if (currentBlock) {
                newBlocks.push({
                    doctor_id: selectedPro.id,
                    tenant_id: tenantId,
                    day_of_week: dayOfWeek,
                    start_time: `${currentBlock.start.toString().padStart(2, '0')}:00`,
                    end_time: `${currentBlock.end.toString().padStart(2, '0')}:00`,
                    block_type: currentBlock.type,
                    location_id: currentBlock.locId
                });
            }
        }

        try {
            setSaving(true);
            const { error: delErr } = await supabase
                .from('doctor_availability')
                .delete()
                .eq('doctor_id', selectedPro.id)
                .eq('tenant_id', tenantId);

            if (delErr) throw delErr;


            // Filter out blocks with null location_id to prevent NOT NULL constraint error
            const blocksToInsert = newBlocks.filter(b => b.location_id !== null);

            if (blocksToInsert.length > 0) {
                const { error: insErr } = await supabase
                    .from('doctor_availability')
                    .insert(blocksToInsert);
                if (insErr) throw insErr;
            }

            await fetchScheduleBlocks(selectedPro.id);
            setSuccess('Agenda atualizada com sucesso!');
        } catch (err: any) {
            console.error(err);
            setError('Erro ao salvar agenda.');
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            const { data: member } = await supabase
                .from('members')
                .select('tenant_id')
                .limit(1)
                .single();
            if (member?.tenant_id) {
                setTenantId(member.tenant_id);
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (tenantId) {
            fetchProfessionals();
            locationService.getAll(tenantId).then(data => {
                setLocations(data);
                if (data.length > 0 && !activeLocationId) {
                    setActiveLocationId(data[0].id);
                }
            }).catch(console.error);
            insurancePlanService.getAll(tenantId).then(setAllPlans).catch(console.error);
        }
    }, [tenantId]);

    // Ensure we always have a location selected if possible
    useEffect(() => {
        if (locations.length > 0 && !activeLocationId) {
            setActiveLocationId(locations[0].id);
        }
    }, [locations, activeLocationId]);

    const fetchProfessionals = async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const data = await professionalService.getAll(tenantId);
            setProfessionals(data);
        } catch (err) {
            console.error(err);
            setError('Erro ao carregar profissionais.');
        } finally {
            setLoading(false);
        }
    };

    // --- Schedule Blocks ---
    const fetchScheduleBlocks = async (doctorId: string) => {
        const { data, error } = await supabase
            .from('doctor_availability')
            .select('*, locations(name)')
            .eq('doctor_id', doctorId)
            .order('day_of_week')
            .order('start_time');
        if (!error && data) setScheduleBlocks(data as any);
    };

    // --- Doctor Insurance Plans ---
    const fetchDoctorPlans = async (doctorId: string) => {
        try {
            const data = await insurancePlanService.getDoctorPlans(doctorId);
            setDoctorPlans(data);
        } catch (e) { console.error(e); }
    };

    const handleLinkPlan = async (planId: string) => {
        if (!selectedPro || !tenantId) return;
        await insurancePlanService.linkDoctorPlan(selectedPro.id, planId, tenantId);
        fetchDoctorPlans(selectedPro.id);
    };

    const handleUnlinkPlan = async (planId: string) => {
        if (!selectedPro) return;
        await insurancePlanService.unlinkDoctorPlan(selectedPro.id, planId);
        fetchDoctorPlans(selectedPro.id);
    };

    // --- Actions ---
    const handleCloseDetail = () => {
        setSelectedPro(null);
        setIsEditing(false);
        setIsCreating(false);
        setForm(EMPTY_FORM);
        setError(null);
        setSuccess(null);
    };

    const handleViewDetail = (p: Professional) => {
        setSelectedPro(p);
        setForm({
            full_name: p.full_name || '',
            email: p.email || '',
            phone: p.phone || '',
            role: p.role || 'doctor',
            specialty: p.specialty || '',
            crm: p.crm || '',
            bio: p.bio || '',
            rqe: p.rqe || '',
            color: p.color || '#1152d4',
            cancellation_policy: p.cancellation_policy || { enabled: false, free_window_hours: 24, late_penalty_percent: 0, no_show_penalty_percent: 100 }
        });
        const bp = (p as any).bot_profile;
        setBotProfile(bp ? {
            pitch: bp.pitch || '',
            selling_points: bp.selling_points?.length ? bp.selling_points : [''],
            objection_scripts: { preco: bp.objection_scripts?.preco || '', tempo: bp.objection_scripts?.tempo || '', urgencia: bp.objection_scripts?.urgencia || '' },
            faq: bp.faq?.length ? bp.faq : [{ q: '', a: '' }],
            pre_appointment_tip: bp.pre_appointment_tip || '',
            consultation_opening: bp.consultation_opening || '',
        } : EMPTY_BOT_PROFILE);
        setIsEditing(false);
        setIsCreating(false);
        setDetailTab('dados');
        fetchScheduleBlocks(p.id);
        fetchDoctorPlans(p.id);
    };

    const handleSaveBotProfile = async () => {
        if (!selectedPro?.id) return;
        setSavingBot(true);
        setError(null);
        try {
            const clean: BotProfile = {
                ...botProfile,
                selling_points: botProfile.selling_points.filter(s => s.trim()),
                faq: botProfile.faq.filter(f => f.q.trim() || f.a.trim()),
            };
            const { error: err } = await supabase
                .from('doctors')
                .update({ bot_profile: clean })
                .eq('id', selectedPro.id);
            if (err) throw err;
            setSuccess('Skills do Bot salvas!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (e: any) {
            setError(e.message || 'Erro ao salvar.');
        } finally {
            setSavingBot(false);
        }
    };

    const [generatingBot, setGeneratingBot] = useState(false);

    const handleGenerateBotProfile = async () => {
        if (!selectedPro?.id) return;
        setGeneratingBot(true);
        setError(null);
        try {
            const { data: json, error: fnError } = await supabase.functions.invoke(
                'generate-bot-profile',
                { body: { doctor_id: selectedPro.id } }
            );

            if (fnError) throw new Error(fnError.message || 'Erro na geração');

            const bp = json.bot_profile;
            setBotProfile({
                pitch: bp.pitch || '',
                consultation_opening: bp.consultation_opening || '',
                selling_points: bp.selling_points?.length ? bp.selling_points : [''],
                objection_scripts: { preco: bp.objection_scripts?.preco || '', tempo: bp.objection_scripts?.tempo || '', urgencia: bp.objection_scripts?.urgencia || '' },
                faq: bp.faq?.length ? bp.faq : [{ q: '', a: '' }],
                pre_appointment_tip: bp.pre_appointment_tip || '',
            });
            setSuccess('Perfil gerado com IA! Revise e salve quando estiver satisfeito.');
            setTimeout(() => setSuccess(null), 5000);
        } catch (e: any) {
            setError(e.message || 'Erro ao gerar perfil.');
        } finally {
            setGeneratingBot(false);
        }
    };

    const handleCreateNew = () => {
        setForm(EMPTY_FORM);
        setSelectedPro({ id: '', tenant_id: tenantId!, is_active: true, ...EMPTY_FORM });
        setIsCreating(true);
        setIsEditing(true);
        setDetailTab('dados');
        setScheduleBlocks([]);
        setDoctorPlans([]);
    };

    const handleEditCurrent = () => {
        if (!selectedPro) return;
        setForm({
            full_name: selectedPro.full_name || '',
            email: selectedPro.email || '',
            phone: selectedPro.phone || '',
            role: selectedPro.role || 'doctor',
            specialty: selectedPro.specialty || '',
            crm: selectedPro.crm || '',
            bio: selectedPro.bio || '',
            rqe: selectedPro.rqe || '',
            color: selectedPro.color || '#1152d4',
            cancellation_policy: selectedPro.cancellation_policy || { enabled: false, free_window_hours: 24, late_penalty_percent: 0, no_show_penalty_percent: 100 }
        });
        setIsEditing(true);
    };

    const handleSaveProfessional = async (nextTab?: 'agenda' | 'convenios') => {
        if (!form.full_name.trim()) {
            setError('Nome é obrigatório.');
            return;
        }
        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            if (isCreating) {
                // If we don't have an ID yet, create. If we do (user went back and forth), update.
                if (!selectedPro?.id) {
                    const newPro = await professionalService.create({ ...form, tenant_id: tenantId! });
                    setSuccess('Profissional cadastrado com sucesso!');
                    setSelectedPro(newPro);
                    if (nextTab) {
                        setDetailTab(nextTab);
                    } else {
                        setIsCreating(false);
                        setIsEditing(false);
                        fetchProfessionals();
                    }
                    return;
                } else {
                    const success = await professionalService.update({ id: selectedPro!.id, ...form });
                    if (success) {
                        setSuccess('Dados salvos!');
                        setSelectedPro({ ...selectedPro, ...form } as Professional);
                        if (nextTab) setDetailTab(nextTab);
                    }
                }
                fetchProfessionals();
            } else if (selectedPro?.id) {
                const success = await professionalService.update({ id: selectedPro.id, ...form });
                if (success) {
                    setSuccess('Profissional atualizado com sucesso!');
                    setSelectedPro({ ...selectedPro, ...form } as Professional);
                    setIsEditing(false);
                }
                fetchProfessionals();
            }
        } catch (err: any) {
            console.error('Error saving professional:', err);
            setError(err.message || 'Erro ao salvar as informações.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (id: string, currentState: boolean) => {
        try {
            await professionalService.toggleActive(id, currentState);
            fetchProfessionals();
        } catch (err: any) {
            setError('Erro ao alterar status: ' + err.message);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await professionalService.delete(id);
            setConfirmDelete(null);
            if (selectedPro?.id === id) handleCloseDetail();
            fetchProfessionals();
        } catch (err: any) {
            setError('Erro ao excluir: ' + err.message);
        }
    };

    const filtered = professionals.filter(p =>
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.specialty?.toLowerCase().includes(search.toLowerCase()) ||
        p.crm?.toLowerCase().includes(search.toLowerCase())
    );

    const roleLabel: Record<string, string> = {
        owner: 'Proprietário',
        admin: 'Administrador',
        doctor: 'Médico',
        staff: 'Recepção',
    };

    const roleColor: Record<string, string> = {
        owner: 'bg-amber-100 text-amber-700',
        admin: 'bg-sky-100 text-sky-700',
        doctor: 'bg-emerald-100 text-emerald-700',
        staff: 'bg-ice-200 text-graphite-600',
    };

    const linkedPlanIds = doctorPlans.map(dp => dp.insurance_plan_id);

    // =============================================
    // DETAIL PANEL VIEW
    // =============================================
    if (selectedPro) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 max-w-5xl mx-auto">
                {/* Back + Header */}
                <div className="flex items-center gap-4">
                    <button onClick={handleCloseDetail} className="p-2 rounded-xl hover:bg-ice-100 transition-colors border-none cursor-pointer bg-transparent text-graphite-500">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-3 flex-1">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: (selectedPro.color || '#1152d4') + '18' }}>
                            <Stethoscope size={22} style={{ color: selectedPro.color || '#1152d4' }} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-graphite-900">{isCreating ? 'Novo Profissional' : selectedPro.full_name}</h1>
                            <p className="text-sm text-graphite-400">
                                {isCreating ? 'Preencha os dados abaixo' : (selectedPro.specialty || roleLabel[selectedPro.role] || selectedPro.role)}
                                {selectedPro.crm && ` · CRM ${selectedPro.crm}`}
                            </p>
                        </div>
                    </div>
                    {/* Main Edit Action */}
                    {!isEditing && !isCreating && (
                        <button onClick={handleEditCurrent} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-primary/10 text-brand-primary font-bold hover:bg-brand-primary/20 transition-colors border-none cursor-pointer">
                            <Pencil size={16} /> Editar
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex bg-white p-1.5 rounded-2xl border border-ice-100 shadow-sm w-fit">
                    {[
                        { id: 'dados' as const, label: 'Dados', icon: Stethoscope, disabled: false },
                        { id: 'agenda' as const, label: 'Agenda Semanal', icon: Clock, disabled: isCreating && !selectedPro?.id },
                        { id: 'convenios' as const, label: 'Convênios', icon: Shield, disabled: isCreating && !selectedPro?.id },
                        { id: 'bot' as const, label: 'Skills do Bot', icon: Bot, disabled: isCreating && !selectedPro?.id },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => !tab.disabled && setDetailTab(tab.id)}
                            disabled={tab.disabled}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all border-none cursor-pointer text-sm ${detailTab === tab.id
                                ? 'bg-brand-primary text-white shadow-md'
                                : tab.disabled
                                    ? 'text-ice-300 cursor-not-allowed'
                                    : 'text-graphite-400 hover:text-brand-primary hover:bg-ice-50'
                                }`}
                            title={tab.disabled ? 'Salve os dados primeiro' : ''}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden min-h-[400px]">

                    {/* Feedback Alerts */}
                    {(error || success) && (
                        <div className={`mx-8 mt-6 mb-0 p-4 rounded-xl flex items-start gap-3 text-sm font-medium animate-in fade-in slide-in-from-top-2 ${error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {error ? <AlertCircle size={18} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={18} className="shrink-0 mt-0.5" />}
                            <span>{error || success}</span>
                            {error && <button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-600 border-none bg-transparent cursor-pointer"><X size={16} /></button>}
                        </div>
                    )}

                    {/* =============== DADOS TAB =============== */}
                    {detailTab === 'dados' && (
                        <div className="p-8">
                            {isEditing ? (
                                /* --- EDIT FORM --- */
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="col-span-2">
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Nome Completo *</label>
                                            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Ex: Dr. João Silva" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">E-mail</label>
                                            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Telefone</label>
                                            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-0000" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Função</label>
                                            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary cursor-pointer h-[46px]">
                                                <option value="doctor">Médico</option>
                                                <option value="staff">Recepção</option>
                                                <option value="admin">Administrador</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Especialidade</label>
                                            <input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Ex: Cardiologia" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">CRM</label>
                                            <input value={form.crm} onChange={(e) => setForm({ ...form, crm: e.target.value })} placeholder="Ex: 123456/SP" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">RQE</label>
                                            <input value={form.rqe || ''} onChange={(e) => setForm({ ...form, rqe: e.target.value })} placeholder="Opcional" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Bio / Observações</label>
                                            <textarea value={form.bio || ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Informações adicionais..." className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors min-h-[100px] resize-none font-sans" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Cor do Avatar</label>
                                            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-full h-[46px] rounded-xl cursor-pointer" />
                                        </div>
                                    </div>

                                    {/* Cancellation Policy Section */}
                                    <div className="mt-8 pt-6 border-t border-ice-100">
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h3 className="text-sm font-black text-graphite-900 uppercase">Regras de Cancelamento</h3>
                                                <p className="text-xs text-graphite-500">Defina se haverá cobrança de multa em caso de cancelamento tardio ou não comparecimento.</p>
                                            </div>
                                            <button
                                                onClick={() => setForm(prev => ({ ...prev, cancellation_policy: { ...prev.cancellation_policy, enabled: !prev.cancellation_policy?.enabled } }))}
                                                className={`w-11 h-6 rounded-full transition-colors relative flex items-center border-none cursor-pointer ${form.cancellation_policy?.enabled ? 'bg-brand-primary' : 'bg-ice-200'}`}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white absolute transition-transform ${form.cancellation_policy?.enabled ? 'translate-x-[26px]' : 'translate-x-[4px]'}`} />
                                            </button>
                                        </div>

                                        {form.cancellation_policy?.enabled && (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-ice-50/50 p-4 rounded-xl border border-ice-100 animate-in fade-in slide-in-from-top-2">
                                                <div>
                                                    <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Grátis até (Horas antes)</label>
                                                    <input
                                                        type="number"
                                                        value={form.cancellation_policy.free_window_hours}
                                                        onChange={(e) => setForm(prev => ({ ...prev, cancellation_policy: { ...prev.cancellation_policy!, free_window_hours: parseInt(e.target.value) || 0 } }))}
                                                        className="w-full bg-white border border-ice-200 rounded-lg px-3 py-2 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary"
                                                        min="0"
                                                    />
                                                    <p className="text-[10px] text-graphite-400 mt-1">Ex: 24h ou 48h antes da consulta.</p>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Multa Cancel. Tardio (%)</label>
                                                    <input
                                                        type="number"
                                                        value={form.cancellation_policy.late_penalty_percent}
                                                        onChange={(e) => setForm(prev => ({ ...prev, cancellation_policy: { ...prev.cancellation_policy!, late_penalty_percent: parseInt(e.target.value) || 0 } }))}
                                                        className="w-full bg-white border border-ice-200 rounded-lg px-3 py-2 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary"
                                                        min="0"
                                                        max="100"
                                                    />
                                                    <p className="text-[10px] text-graphite-400 mt-1">Acaba recaindo sobre o valor do procedimento/consulta.</p>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Multa No-Show (%)</label>
                                                    <input
                                                        type="number"
                                                        value={form.cancellation_policy.no_show_penalty_percent}
                                                        onChange={(e) => setForm(prev => ({ ...prev, cancellation_policy: { ...prev.cancellation_policy!, no_show_penalty_percent: parseInt(e.target.value) || 0 } }))}
                                                        className="w-full bg-white border border-ice-200 rounded-lg px-3 py-2 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary"
                                                        min="0"
                                                        max="100"
                                                    />
                                                    <p className="text-[10px] text-graphite-400 mt-1">Multa caso o paciente não desmarque e falte.</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-3 pt-6 border-t border-ice-100">
                                        <button onClick={() => { setIsEditing(false); if (isCreating) handleCloseDetail(); }} className="flex-1 py-3 rounded-xl font-bold text-graphite-500 hover:bg-ice-50 transition-colors border-none cursor-pointer">
                                            Cancelar
                                        </button>
                                        <button onClick={() => handleSaveProfessional(isCreating ? 'agenda' : undefined)} disabled={saving} className="flex-1 bg-brand-primary text-white py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/90 transition-all border-none cursor-pointer disabled:opacity-50 flex justify-center items-center gap-2">
                                            {saving ? 'Salvando...' : isCreating ? <>Próximo <ArrowRight size={18} /></> : <><Save size={18} /> Salvar</>}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* --- READ ONLY VIEW --- */
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {[
                                        { label: 'Nome Completo', value: selectedPro.full_name },
                                        { label: 'E-mail', value: selectedPro.email || '—' },
                                        { label: 'Telefone', value: selectedPro.phone || '—' },
                                        { label: 'Função', value: roleLabel[selectedPro.role] || selectedPro.role },
                                        { label: 'Especialidade', value: selectedPro.specialty || '—' },
                                        { label: 'CRM', value: selectedPro.crm || '—' },
                                        { label: 'RQE', value: selectedPro.rqe || '—' },
                                        { label: 'Auto-Release', value: `${(selectedPro as any).auto_release_hours ?? 24}h antes do slot` },
                                    ].map((f, i) => (
                                        <div key={i} className="space-y-1">
                                            <label className="text-xs font-black text-graphite-400 uppercase">{f.label}</label>
                                            <p className="text-sm font-medium text-graphite-900">{f.value}</p>
                                        </div>
                                    ))}
                                    {selectedPro.bio && (
                                        <div className="col-span-2 space-y-1">
                                            <label className="text-xs font-black text-graphite-400 uppercase">Bio</label>
                                            <p className="text-sm text-graphite-700 whitespace-pre-line">{selectedPro.bio}</p>
                                        </div>
                                    )}

                                    {/* Read-only Cancellation Policy */}
                                    <div className="col-span-2 mt-4 pt-4 border-t border-ice-100">
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">Regras de Cancelamento</label>
                                        {selectedPro.cancellation_policy?.enabled ? (
                                            <div className="bg-ice-50/50 p-3 rounded-xl border border-ice-100 flex gap-4 text-sm">
                                                <div className="flex items-center gap-2 text-graphite-700">
                                                    <Clock size={16} className="text-brand-primary" />
                                                    <span>Grátis até <strong>{selectedPro.cancellation_policy.free_window_hours}h</strong></span>
                                                </div>
                                                <div className="flex items-center gap-2 text-graphite-700">
                                                    <AlertCircle size={16} className="text-rose-400" />
                                                    <span>Multa Atraso: <strong>{selectedPro.cancellation_policy.late_penalty_percent}%</strong></span>
                                                </div>
                                                <div className="flex items-center gap-2 text-graphite-700">
                                                    <AlertCircle size={16} className="text-rose-500" />
                                                    <span>Multa Falta: <strong>{selectedPro.cancellation_policy.no_show_penalty_percent}%</strong></span>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-graphite-500 italic">Nenhuma regra de cancelamento e multa configurada.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* =============== AGENDA TAB =============== */}
                    {/* =============== AGENDA TAB =============== */}
                    {detailTab === 'agenda' && (
                        <div className="p-8 space-y-6">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="text-lg font-black text-graphite-900">Blocos de Horário</h3>
                                    <p className="text-sm text-graphite-400">Configure horários particulares e regulares para agenda inteligente.</p>
                                </div>
                            </div>

                            {/* --- TOOLBAR --- */}
                            <div className="flex flex-col md:flex-row gap-4 justify-between bg-ice-50/50 p-4 rounded-2xl border border-ice-100">
                                <div className="flex items-center gap-2">
                                    <div className="flex p-1 bg-white rounded-xl border border-ice-200">
                                        {(['prime', 'regular', 'blocked', 'eraser'] as ToolType[]).map(tool => (
                                            <button
                                                key={tool}
                                                onClick={() => setSelectedTool(tool)}
                                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all border-none cursor-pointer ${selectedTool === tool
                                                    ? 'bg-brand-primary text-white shadow-md'
                                                    : 'text-graphite-400 hover:text-brand-primary hover:bg-ice-50'
                                                    }`}
                                            >
                                                {tool === 'prime' ? 'Prime' : tool === 'regular' ? 'Regular' : tool === 'blocked' ? 'Bloquear' : 'Borracha'}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <label className="text-xs font-black text-graphite-400 uppercase">Local Selecionado:</label>
                                    <select
                                        value={activeLocationId || ''}
                                        onChange={e => setActiveLocationId(e.target.value)}
                                        className="bg-white border border-ice-200 rounded-xl px-4 py-2 font-bold text-graphite-900 focus:outline-none focus:border-brand-primary min-w-[200px]"
                                    >
                                        {locations.length === 0 && <option value="" disabled>Carregando locais...</option>}
                                        {locations.map(loc => (
                                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    onClick={saveGridToDB}
                                    disabled={saving}
                                    className="bg-brand-primary text-white px-6 py-2 rounded-xl font-bold hover:bg-brand-primary/90 transition-all flex items-center gap-2 border-none cursor-pointer shadow-lg shadow-brand-primary/20 disabled:opacity-50"
                                >
                                    {saving ? 'Salvando...' : 'Salvar Agenda'}
                                </button>
                            </div>

                            {/* --- HEATMAP GRID --- */}
                            <div className="border border-ice-200 rounded-2xl overflow-hidden bg-white select-none" onMouseLeave={() => setIsMouseDown(false)}>
                                <div className="grid grid-cols-[60px_repeat(7,1fr)] divide-x divide-ice-100 border-b border-ice-100 bg-ice-50">
                                    <div className="p-3 text-xs font-black text-graphite-400 text-center flex items-center justify-center">Hora</div>
                                    {DAYS.map(d => (
                                        <div key={d} className="p-3 text-xs font-black text-graphite-500 uppercase text-center">{d}</div>
                                    ))}
                                </div>

                                <div className="divide-y divide-ice-100" onMouseDown={() => setIsMouseDown(true)} onMouseUp={() => setIsMouseDown(false)}>
                                    {HOURS.map(h => (
                                        <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] divide-x divide-ice-100 h-10">
                                            <div className="text-xs font-bold text-graphite-400 flex items-center justify-center bg-ice-50/50">
                                                {h.toString().padStart(2, '0')}:00
                                            </div>
                                            {DAYS.map((_, i) => {
                                                const day = i; // 0=Dom, 1=Seg...
                                                const hour = h;
                                                const cell = gridState[day]?.[hour];
                                                const isActive = !!cell;
                                                const isMine = isActive && (!activeLocationId || cell?.location_id === activeLocationId);
                                                const isOtherLocation = !!(isActive && activeLocationId && cell?.location_id !== activeLocationId);
                                                const isPrime = cell?.type === 'prime';
                                                const isManualBlocked = cell?.type === 'blocked';

                                                // Check if blocked by location rules (Operating Hours)
                                                let isOperatingBlocked = false;
                                                if (activeLocationId) {
                                                    const loc = locations.find(l => l.id === activeLocationId);
                                                    if (loc?.operating_hours) {
                                                        const oh = loc.operating_hours[day] || (loc.operating_hours as any)[day.toString()];
                                                        // RESTRICTION: Missing JSON for the day or marked closed = BLOCKED.
                                                        if (!oh || oh.closed) {
                                                            isOperatingBlocked = true;
                                                        } else {
                                                            const startH = parseInt(oh.start.split(':')[0]);
                                                            const endH = parseInt(oh.end.split(':')[0]);
                                                            if (hour < startH || hour >= endH) isOperatingBlocked = true;
                                                        }
                                                    }
                                                }

                                                // Final blocking logic: blocked if outside unit hours OR occupied by another location
                                                const isBlocked = isOperatingBlocked || isOtherLocation;

                                                return (
                                                    <button
                                                        key={day}
                                                        disabled={isBlocked && selectedTool !== 'eraser'}
                                                        className={`w-full h-8 rounded-md transition-all border-none relative overflow-hidden ${isOperatingBlocked
                                                            ? 'bg-graphite-200/40 cursor-not-allowed border border-graphite-300/20'
                                                            : isOtherLocation
                                                                ? 'bg-slate-100 cursor-not-allowed border border-slate-200 shadow-inner'
                                                                : isActive
                                                                    ? isMine
                                                                        ? isPrime ? 'bg-brand-primary shadow-inner ring-1 ring-white/20' : 'bg-brand-primary/30 border border-brand-primary/20'
                                                                        : 'bg-slate-200 border border-slate-300'
                                                                    : 'bg-ice-50 hover:bg-ice-100 cursor-pointer border border-transparent'
                                                            }`}
                                                        style={{
                                                            backgroundColor: isMine
                                                                ? (isManualBlocked ? '#F1F5F9' : (isPrime ? (selectedPro.color || '#1152d4') : '#60a5fa'))
                                                                : isOperatingBlocked 
                                                                    ? '#F8FAFC'
                                                                    : undefined,
                                                            backgroundImage: isOtherLocation 
                                                                ? 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 5px, #e2e8f0 5px, #e2e8f0 10px)'
                                                                : isManualBlocked 
                                                                    ? 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(148, 163, 184, 0.1) 5px, rgba(148, 163, 184, 0.1) 10px)' 
                                                                    : undefined
                                                        }}
                                                        onMouseDown={() => {
                                                            if (isBlocked && selectedTool !== 'eraser') return;
                                                            setIsMouseDown(true);
                                                            handlePaint(day, hour);
                                                        }}
                                                        onMouseEnter={() => {
                                                            if (isMouseDown && (!isOperatingBlocked || selectedTool === 'eraser')) {
                                                                handlePaint(day, hour);
                                                            }
                                                        }}
                                                    >
                                                        {isMine && (
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
                                                                {/* Status Icon */}
                                                                {isManualBlocked ? (
                                                                    <X size={12} className="text-slate-400 opacity-60" />
                                                                ) : isPrime ? (
                                                                    <Star size={10} className="text-white opacity-60" />
                                                                ) : null}
                                                                
                                                                {/* Location Label */}
                                                                {cell.location_id && (
                                                                    <div className="text-[6px] font-black text-white/60 bg-black/5 rounded px-0.5 uppercase truncate max-w-[90%] text-center">
                                                                        {locations.find(l => l.id === cell.location_id)?.name.substring(0, 3)}
                                                                    </div>
                                                                )}

                                                                {/* Fallback Dot for regular slots without location (painting) */}
                                                                {!cell.location_id && !isManualBlocked && !isPrime && isActive && activeLocationId && selectedTool !== 'eraser' && (
                                                                    <div className="w-1 h-1 rounded-full bg-white/30" />
                                                                )}
                                                            </div>
                                                        )}

                                                        {isOperatingBlocked && (
                                                            <div className="absolute inset-0 flex items-center justify-center bg-graphite-900/5">
                                                                <X size={14} className="text-graphite-400 stroke-[3]" />
                                                            </div>
                                                        )}

                                                        {isOtherLocation && (
                                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/5">
                                                                <div className="text-[8px] font-black text-slate-700 uppercase truncate px-1 bg-white/70 rounded shadow-sm">
                                                                    {locations.find(l => l.id === cell.location_id)?.name.substring(0, 3)}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between items-center text-xs text-graphite-400 px-2 mt-4">
                                <p>Clique e arraste para definir horários.</p>
                                <button onClick={saveGridToDB} className="text-brand-primary font-bold hover:underline cursor-pointer border-none bg-transparent">
                                    Salvar Alterações na Grade
                                </button>
                            </div>

                            {/* Wizard Footer for Agenda */}
                            {isCreating && (
                                <div className="flex gap-3 pt-4 border-t border-ice-100 justify-between">
                                    <button onClick={() => setDetailTab('dados')} className="px-6 py-3 rounded-xl font-bold text-graphite-500 hover:bg-ice-50 transition-colors border-none cursor-pointer">
                                        Anterior
                                    </button>
                                    <button onClick={() => setDetailTab('convenios')} className="px-6 py-3 rounded-xl font-bold bg-brand-primary text-white shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/90 transition-all border-none cursor-pointer flex items-center gap-2">
                                        Próximo <ArrowRight size={18} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* =============== CONVÊNIOS TAB =============== */}
                    {detailTab === 'convenios' && (
                        <div className="p-8 space-y-6">
                            <div>
                                <h3 className="text-lg font-black text-graphite-900">Convênios Aceitos</h3>
                                <p className="text-sm text-graphite-400">Selecione os convênios que este profissional atende.</p>
                            </div>

                            {allPlans.length === 0 ? (
                                <div className="text-center py-12 text-graphite-400">
                                    <Shield size={48} className="mx-auto mb-3 text-ice-300" />
                                    <p className="font-bold">Nenhum convênio cadastrado</p>
                                    <p className="text-sm">Cadastre convênios em Configurações → Convênios primeiro.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {allPlans.map(plan => {
                                        const isLinked = linkedPlanIds.includes(plan.id);
                                        return (
                                            <div key={plan.id} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${isLinked
                                                ? 'border-emerald-200 bg-emerald-50/50'
                                                : 'border-ice-100 hover:border-ice-200'
                                                }`}
                                                onClick={() => isLinked ? handleUnlinkPlan(plan.id) : handleLinkPlan(plan.id)}
                                            >
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isLinked ? 'bg-emerald-100 text-emerald-600' : 'bg-ice-100 text-graphite-400'}`}>
                                                    {isLinked ? <CheckCircle2 size={20} /> : <Shield size={20} />}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="font-bold text-graphite-900">{plan.name}</p>
                                                    {plan.code && <p className="text-xs text-graphite-400">ANS: {plan.code}</p>}
                                                </div>
                                                <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${isLinked
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : 'bg-ice-100 text-graphite-400'
                                                    }`}>
                                                    {isLinked ? 'Vinculado' : 'Vincular'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Wizard Footer for Convenios */}
                            {isCreating && (
                                <div className="flex gap-3 pt-4 border-t border-ice-100 justify-between">
                                    <button onClick={() => setDetailTab('agenda')} className="px-6 py-3 rounded-xl font-bold text-graphite-500 hover:bg-ice-50 transition-colors border-none cursor-pointer">
                                        Anterior
                                    </button>
                                    <button onClick={handleCloseDetail} className="px-6 py-3 rounded-xl font-bold bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all border-none cursor-pointer flex items-center gap-2">
                                        Concluir <Check size={18} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* =============== BOT SKILLS TAB =============== */}
                    {detailTab === 'bot' && (
                        <div className="p-8 space-y-8">
                            {/* Header */}
                            <div className="flex items-center justify-between pb-2 border-b border-ice-100">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                                        <Sparkles size={20} className="text-indigo-500" />
                                    </div>
                                    <div>
                                        <h3 className="font-black text-graphite-900">Skills do Bot</h3>
                                        <p className="text-xs text-graphite-400 font-medium">O agente usa essas informações para personalizar o atendimento deste profissional.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleGenerateBotProfile}
                                    disabled={generatingBot}
                                    className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-transform border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                                    title="Gera automaticamente o perfil do bot com base nos dados do profissional"
                                >
                                    {generatingBot
                                        ? <><span className="animate-spin inline-block">⏳</span> Gerando...</>
                                        : <><Sparkles size={15} /> Gerar com IA</>
                                    }
                                </button>
                            </div>

                            {/* Pitch */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Apresentação do Profissional</label>
                                <p className="text-xs text-graphite-400 mb-2">Como o bot deve apresentar este profissional. Ex: "Dr. João é especialista em Ortodontia Invisível com 12 anos de experiência."</p>
                                <textarea
                                    value={botProfile.pitch}
                                    onChange={e => setBotProfile(p => ({ ...p, pitch: e.target.value }))}
                                    rows={3}
                                    placeholder="Descreva o diferencial e especialização do profissional..."
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                                />
                            </div>

                            {/* Consultation Opening */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Abertura da Consulta</label>
                                <p className="text-xs text-graphite-400 mb-2">O que o paciente pode esperar nesta consulta. Usado quando o bot apresenta o serviço.</p>
                                <textarea
                                    value={botProfile.consultation_opening}
                                    onChange={e => setBotProfile(p => ({ ...p, consultation_opening: e.target.value }))}
                                    rows={2}
                                    placeholder="Ex: A avaliação ortodôntica inclui análise completa e apresentação de um plano personalizado..."
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                                />
                            </div>

                            {/* Selling Points */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Diferenciais / Pontos de Venda</label>
                                <p className="text-xs text-graphite-400 mb-2">Argumentos que o bot pode usar para convencer o paciente a agendar.</p>
                                <div className="space-y-2">
                                    {botProfile.selling_points.map((sp, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input
                                                value={sp}
                                                onChange={e => setBotProfile(p => {
                                                    const arr = [...p.selling_points];
                                                    arr[i] = e.target.value;
                                                    return { ...p, selling_points: arr };
                                                })}
                                                placeholder={`Ex: Parcelamento em até 24x sem juros`}
                                                className="flex-1 bg-ice-50 border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors"
                                            />
                                            <button
                                                onClick={() => setBotProfile(p => ({ ...p, selling_points: p.selling_points.filter((_, j) => j !== i) }))}
                                                className="p-2.5 rounded-xl text-rose-400 hover:bg-rose-50 border-none cursor-pointer transition-colors"
                                            ><X size={16} /></button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => setBotProfile(p => ({ ...p, selling_points: [...p.selling_points, ''] }))}
                                        className="flex items-center gap-2 text-sm font-bold text-brand-primary hover:text-brand-primary/80 border-none bg-transparent cursor-pointer px-1 py-1"
                                    ><Plus size={16} /> Adicionar diferencial</button>
                                </div>
                            </div>

                            {/* Objection Scripts */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Scripts de Objeção</label>
                                <p className="text-xs text-graphite-400 mb-3">Respostas exatas que o bot deve usar quando o paciente apresentar cada objeção.</p>
                                <div className="space-y-4">
                                    {([
                                        { key: 'preco', label: 'Objeção de Preço', placeholder: 'Ex: Temos parcelamento em até 24x. Posso confirmar o horário para a avaliação, que é sem compromisso?' },
                                        { key: 'tempo', label: 'Objeção de Tempo', placeholder: 'Ex: A consulta dura apenas 30 minutos. Tenho um horário às 7h da manhã que pode facilitar...' },
                                        { key: 'urgencia', label: 'Objeção de Urgência ("não é urgente")', placeholder: 'Ex: Entendo! A agenda costuma fechar 2-3 semanas à frente. Quer garantir agora para não ter essa preocupação depois?' },
                                    ] as const).map(({ key, label, placeholder }) => (
                                        <div key={key}>
                                            <label className="text-xs font-bold text-graphite-500 mb-1 block">{label}</label>
                                            <textarea
                                                value={botProfile.objection_scripts[key]}
                                                onChange={e => setBotProfile(p => ({ ...p, objection_scripts: { ...p.objection_scripts, [key]: e.target.value } }))}
                                                rows={2}
                                                placeholder={placeholder}
                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* FAQ */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Perguntas Frequentes (FAQ)</label>
                                <p className="text-xs text-graphite-400 mb-3">O bot responde diretamente com estas respostas quando detectar as perguntas dos pacientes.</p>
                                <div className="space-y-3">
                                    {botProfile.faq.map((item, i) => (
                                        <div key={i} className="bg-ice-50 border border-ice-200 rounded-xl p-4 space-y-2">
                                            <div className="flex gap-2 items-start">
                                                <div className="flex-1 space-y-2">
                                                    <input
                                                        value={item.q}
                                                        onChange={e => setBotProfile(p => {
                                                            const arr = [...p.faq];
                                                            arr[i] = { ...arr[i], q: e.target.value };
                                                            return { ...p, faq: arr };
                                                        })}
                                                        placeholder="Pergunta do paciente (ex: Quanto custa?)"
                                                        className="w-full bg-white border border-ice-200 rounded-lg px-3 py-2 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors"
                                                    />
                                                    <textarea
                                                        value={item.a}
                                                        onChange={e => setBotProfile(p => {
                                                            const arr = [...p.faq];
                                                            arr[i] = { ...arr[i], a: e.target.value };
                                                            return { ...p, faq: arr };
                                                        })}
                                                        rows={2}
                                                        placeholder="Resposta do bot..."
                                                        className="w-full bg-white border border-ice-200 rounded-lg px-3 py-2 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => setBotProfile(p => ({ ...p, faq: p.faq.filter((_, j) => j !== i) }))}
                                                    className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 border-none cursor-pointer transition-colors mt-0.5"
                                                ><X size={15} /></button>
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => setBotProfile(p => ({ ...p, faq: [...p.faq, { q: '', a: '' }] }))}
                                        className="flex items-center gap-2 text-sm font-bold text-brand-primary hover:text-brand-primary/80 border-none bg-transparent cursor-pointer px-1 py-1"
                                    ><Plus size={16} /> Adicionar pergunta</button>
                                </div>
                            </div>

                            {/* Pre-appointment Tip */}
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1.5 block">Instrução Pré-Consulta</label>
                                <p className="text-xs text-graphite-400 mb-2">Enviada ao paciente na confirmação do agendamento. Ex: "Traga radiografias recentes."</p>
                                <input
                                    value={botProfile.pre_appointment_tip}
                                    onChange={e => setBotProfile(p => ({ ...p, pre_appointment_tip: e.target.value }))}
                                    placeholder="Ex: Para aproveitar melhor a consulta, traga exames recentes se tiver."
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors"
                                />
                            </div>

                            {/* Save Button */}
                            <div className="flex justify-end pt-2 border-t border-ice-100">
                                <button
                                    onClick={handleSaveBotProfile}
                                    disabled={savingBot}
                                    className="flex items-center gap-2 bg-brand-primary text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer disabled:opacity-50"
                                >
                                    {savingBot ? <><span className="animate-spin">⏳</span> Salvando...</> : <><Save size={16} /> Salvar Skills</>}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // =============================================
    // MAIN LIST VIEW
    // =============================================
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Profissionais</h1>
                    <p className="text-graphite-500 font-medium">Equipe médica e administrativa da clínica.</p>
                </div>
                <button
                    onClick={handleCreateNew}
                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-transform border-none cursor-pointer"
                >
                    <UserPlus size={18} />
                    Adicionar
                </button>
            </div>

            {/* Global Error Toast */}
            {error && (
                <div className="bg-rose-50 text-rose-600 p-4 rounded-xl flex items-start gap-3 text-sm font-medium animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-rose-400 hover:text-rose-600 border-none bg-transparent cursor-pointer"><X size={16} /></button>
                </div>
            )}

            {/* Search */}
            <div className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nome, especialidade ou CRM..."
                    className="w-full bg-white border border-ice-200 rounded-2xl pl-12 pr-4 py-3.5 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300"
                />
            </div>

            {/* List */}
            <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">Carregando equipe...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">
                        {professionals.length === 0 ? 'Nenhum profissional cadastrado. Clique em "Adicionar" para começar.' : 'Nenhum resultado para a busca.'}
                    </div>
                ) : (
                    <div className="divide-y divide-ice-100">
                        {filtered.map((p) => (
                            <div
                                key={p.id}
                                className="flex items-center gap-4 p-5 hover:bg-ice-50/50 transition-colors relative cursor-pointer"
                                onClick={() => handleViewDetail(p)}
                            >
                                {/* Color indicator */}
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: (p.color || '#1152d4') + '18' }}>
                                    {p.role === 'doctor' ? (
                                        <Stethoscope size={22} style={{ color: p.color || '#1152d4' }} />
                                    ) : (
                                        <Shield size={22} className="text-graphite-400" />
                                    )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-black text-graphite-900 truncate">{p.full_name || 'Sem nome'}</p>
                                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${roleColor[p.role] || 'bg-ice-100 text-graphite-500'}`}>
                                            {roleLabel[p.role] || p.role}
                                        </span>
                                        {!p.is_active && (
                                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-rose-100 text-rose-600">Inativo</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                                        {p.specialty && <span className="text-xs text-graphite-500 font-medium">{p.specialty}</span>}
                                        {p.crm && <span className="text-xs text-graphite-300 font-medium">CRM {p.crm}</span>}
                                        {p.email && (
                                            <span className="text-xs text-graphite-300 font-medium flex items-center gap-1">
                                                <Mail size={10} /> {p.email}
                                            </span>
                                        )}
                                        {p.phone && (
                                            <span className="text-xs text-graphite-300 font-medium flex items-center gap-1">
                                                <Phone size={10} /> {phoneFlag(p.phone)} {formatPhone(p.phone)}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                    <button
                                        onClick={() => {
                                            handleViewDetail(p);
                                            // Slight timeout to let render happen, then switch to edit (optional, or just pass a flag)
                                            // Actually helper above does setEditing(false). Let's do it manually:
                                            setSelectedPro(p);
                                            setForm(p as any);
                                            setIsEditing(true);
                                            setIsCreating(false);
                                            setDetailTab('dados');
                                            fetchScheduleBlocks(p.id);
                                            fetchDoctorPlans(p.id);
                                        }}
                                        className="p-2 text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all border-none cursor-pointer bg-transparent"
                                        title="Editar"
                                    >
                                        <Pencil size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleToggleActive(p.id, p.is_active)}
                                        className="p-2 rounded-xl border-none cursor-pointer transition-colors bg-transparent"
                                        title={p.is_active ? 'Desativar' : 'Ativar'}
                                    >
                                        {p.is_active ? (
                                            <ToggleRight size={20} className="text-emerald-500" />
                                        ) : (
                                            <ToggleLeft size={20} className="text-graphite-300" />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete(p.id)}
                                        className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border-none cursor-pointer bg-transparent"
                                        title="Excluir"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Confirm Delete Dialog */}
            {confirmDelete && (
                <>
                    <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={() => setConfirmDelete(null)} />
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-white pointer-events-auto w-full max-w-sm rounded-[24px] shadow-2xl p-8 text-center border border-white/20">
                            <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center mx-auto mb-4">
                                <Trash2 size={24} className="text-rose-500" />
                            </div>
                            <h3 className="text-lg font-black text-graphite-900 mb-2">Remover Profissional?</h3>
                            <p className="text-sm text-graphite-500 mb-6">Esta ação não pode ser desfeita. O profissional será removido do quadro da clínica.</p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setConfirmDelete(null)}
                                    className="flex-1 py-3 rounded-xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => handleDelete(confirmDelete)}
                                    className="flex-1 bg-rose-500 text-white py-3 rounded-xl font-bold hover:bg-rose-600 transition-all border-none cursor-pointer"
                                >
                                    Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
