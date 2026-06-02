import React from 'react';
import { PatientStageCard } from './PatientStageCard';
import { usePatientFunnel } from '../../hooks/usePatientFunnel';
import type { FunnelStage } from '../../hooks/usePatientFunnel';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Users, 
    Zap, 
    TrendingUp, 
    Target, 
    XCircle, 
    Calendar,
    GripVertical
} from 'lucide-react';
import { clsx } from 'clsx';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    DragOverlay,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface FunilCaptacaoProps {
  tenantId: string;
  onViewJourney: (phone: string, name: string) => void;
  onStartConversation: (phone: string) => void;
  dateRange: { from: Date; to: Date };
}

export const FunilCaptacao: React.FC<FunilCaptacaoProps> = ({ tenantId, onViewJourney, onStartConversation, dateRange }) => {
    const { stages, movePatient, cancelAllPendingForPatient, isLoading } = usePatientFunnel({ tenantId, dateRange });
    const [activeId, setActiveId] = React.useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    const columns: { key: FunnelStage; label: string; icon: any; color: string }[] = [
        { key: 'novo_lead', label: 'Novo Lead', icon: Target, color: 'bg-ice-50 border-blue-500 text-blue-600' },
        { key: 'em_follow_up', label: 'Em Follow-up', icon: Zap, color: 'bg-ice-50 border-orange-400 text-orange-500' },
        { key: 'qualificado', label: 'Qualificado', icon: TrendingUp, color: 'bg-ice-50 border-yellow-400 text-yellow-600' },
        { key: 'agendado', label: 'Agendado', icon: Calendar, color: 'bg-emerald-50 border-emerald-500 text-emerald-600' },
        { key: 'perdido', label: 'Perdido', icon: XCircle, color: 'bg-ice-50 border-graphite-300 text-graphite-400' }
    ];

    const handleDragStart = (event: any) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event: any) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeItemPhone = active.data.current?.patient_phone;
        const overColumnKey = over.id as FunnelStage;

        if (activeItemPhone && columns.some(c => c.key === overColumnKey)) {
            // Check if it's actually changing columns
            const currentStage = active.data.current?.current_stage;
            if (currentStage !== overColumnKey) {
                await movePatient(activeItemPhone, overColumnKey);
            }
        }
    };

    const totalLeads = Object.values(stages).reduce((sum, list) => sum + list.length, 0);
    const scheduledCount = stages.agendado.length;
    const conversionRate = totalLeads > 0 ? (scheduledCount / totalLeads) * 100 : 0;

    const findActivePatient = () => {
        for (const list of Object.values(stages)) {
            const found = list.find(p => p.id === activeId);
            if (found) return found;
        }
        return null;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-ice-100 border-t-brand-primary rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Funnel Metrics Summary */}
            <div className="flex items-center gap-6 overflow-x-auto pb-2 scrollbar-hide">
                <div className="bg-white rounded-[32px] p-6 border border-ice-100 shadow-sm min-w-[240px] flex items-center gap-5">
                    <div className="w-14 h-14 bg-brand-primary/10 rounded-[20px] flex items-center justify-center text-brand-primary">
                        <Users size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase text-graphite-300 tracking-[0.15em] mb-1">Total Leads</p>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tighter leading-none">{totalLeads}</h3>
                    </div>
                </div>
                
                <div className="bg-white rounded-[32px] p-6 border border-ice-100 shadow-sm min-w-[240px] flex items-center gap-5">
                    <div className="w-14 h-14 bg-emerald-50 rounded-[20px] flex items-center justify-center text-emerald-600">
                        <TrendingUp size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase text-graphite-300 tracking-[0.15em] mb-1">Taxa de Conversão</p>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tighter leading-none">{conversionRate.toFixed(1)}%</h3>
                    </div>
                </div>
                
                <div className="bg-white rounded-[32px] p-6 border border-ice-100 shadow-sm min-w-[280px] flex items-center gap-5">
                    <div className="w-14 h-14 bg-brand-secondary/30 rounded-[20px] flex items-center justify-center text-brand-primary">
                        <Zap size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase text-graphite-300 tracking-[0.15em] mb-1">Ações Pendentes</p>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tighter leading-none">{Object.values(stages).reduce((sum, list) => sum + list.filter(p => !!p.next_action_at).length, 0)}</h3>
                    </div>
                </div>
            </div>

            {/* Kanban Columns with DND Context */}
            <DndContext 
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                    {columns.map((col) => (
                        <FunnelColumn 
                            key={col.key} 
                            col={col} 
                            patients={stages[col.key]}
                            onViewJourney={onViewJourney}
                            onMove={movePatient}
                            onCancel={cancelAllPendingForPatient}
                            onStartConversation={onStartConversation}
                        />
                    ))}
                </div>

                <DragOverlay dropAnimation={{
                    sideEffects: defaultDropAnimationSideEffects({
                        styles: {
                            active: {
                                opacity: '0.4',
                            },
                        },
                    }),
                }}>
                    {activeId ? (
                        <div className="scale-105 rotate-2 shadow-2xl rounded-2xl overflow-hidden pointer-events-none opacity-90">
                            <PatientStageCard 
                                patient={findActivePatient()!}
                                onViewJourney={() => {}}
                                onMove={() => {}}
                                onCancel={() => {}}
                                onStartConversation={() => {}}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    );
};

// Internal components for clean organization
const FunnelColumn = ({ col, patients, onViewJourney, onMove, onCancel, onStartConversation }: any) => {
    const { setNodeRef, isOver } = useSortable({
        id: col.key,
        data: { type: 'column' }
    });

    return (
        <div 
            ref={setNodeRef}
            className={clsx(
                "flex flex-col h-full min-h-[600px] transition-colors rounded-[32px]",
                isOver ? "bg-brand-primary/5 ring-2 ring-brand-primary/20 ring-inset" : "bg-transparent"
            )}
        >
            {/* Column Header */}
            <div className={clsx(
                "flex items-center justify-between p-4 rounded-2xl mb-4 border-l-4 shadow-sm relative overflow-hidden",
                col.color
            )}>
                <div className="flex items-center gap-2">
                    <col.icon size={18} className="shrink-0" />
                    <span className="font-black text-xs uppercase tracking-wider">{col.label}</span>
                </div>
                <span className="bg-white/50 px-2 py-0.5 rounded-lg text-xs font-black">{patients.length}</span>
            </div>

            {/* Column Content */}
            <div className="flex-1 space-y-4 pr-1 max-h-[1200px] overflow-y-auto custom-scrollbar-small pb-6">
                <SortableContext items={patients.map((p: any) => p.id)} strategy={verticalListSortingStrategy}>
                    <AnimatePresence mode="popLayout">
                        {patients.length === 0 ? (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-ice-100 rounded-3xl opacity-40 h-32"
                            >
                                <p className="text-[10px] font-bold text-graphite-300 uppercase tracking-widest">
                                    Vazio
                                </p>
                            </motion.div>
                        ) : (
                            patients.map((patient: any) => (
                                <SortablePatientCard 
                                    key={patient.id} 
                                    patient={patient} 
                                    onViewJourney={onViewJourney}
                                    onMove={onMove}
                                    onCancel={onCancel}
                                    onStartConversation={onStartConversation}
                                />
                            ))
                        )}
                    </AnimatePresence>
                </SortableContext>
            </div>
        </div>
    );
};

const SortablePatientCard = ({ patient, ...props }: any) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: patient.id,
        data: { ...patient }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} className="relative group">
            <div 
                {...listeners} 
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-1 opacity-0 group-hover:opacity-100 hover:bg-ice-50 rounded-lg cursor-grab active:cursor-grabbing transition-all text-graphite-300"
            >
                <GripVertical size={14} />
            </div>
            <div className="pl-0">
                <PatientStageCard patient={patient} {...props} />
            </div>
        </div>
    );
};
