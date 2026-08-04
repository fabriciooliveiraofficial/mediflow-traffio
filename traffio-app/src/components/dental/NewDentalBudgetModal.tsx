import React, { useState } from 'react';
import { X, Plus, Trash2, Save, Calculator, DollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dentalService } from '../../services/dentalService';
import type { DentalBudgetItem } from '../../services/dentalService';
import { useToast } from '../../contexts/ToastContext';
import { useTenant } from '../../contexts/TenantContext';
import { useTenantMoney } from '../../hooks/useTenantMoney';

interface NewDentalBudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId: string;
    preSelectedTeeth?: Array<{ tooth: number, plane: string }>;
}

export const NewDentalBudgetModal: React.FC<NewDentalBudgetModalProps> = ({ 
    isOpen, 
    onClose, 
    onSuccess, 
    patientId,
    preSelectedTeeth = []
}) => {
    const { t } = useTranslation('medical');
    const { tenant } = useTenant();
    const { format: formatMoney } = useTenantMoney();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);

    const [notes, setNotes] = useState('');
    const [validUntil, setValidUntil] = useState(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    // Initial items from pre-selected teeth
    const initialItems: Omit<DentalBudgetItem, 'id'>[] = preSelectedTeeth.map(tooth => ({
        tooth_number: tooth.tooth,
        plane: tooth.plane,
        procedure_name: t('dentalModals.newBudget.autoProcedureName', { tooth: tooth.tooth, plane: tooth.plane }),
        unit_price: 150,
        quantity: 1,
        total_price: 150
    }));

    const [items, setItems] = useState<Omit<DentalBudgetItem, 'id'>[]>(
        initialItems.length > 0 ? initialItems : [{ procedure_name: '', unit_price: 0, quantity: 1, total_price: 0 }]
    );

    if (!isOpen) return null;

    const addItem = () => {
        setItems([...items, { procedure_name: '', unit_price: 0, quantity: 1, total_price: 0 }]);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const updateItem = (index: number, updates: Partial<DentalBudgetItem>) => {
        const newItems = [...items];
        const item = { ...newItems[index], ...updates };
        
        // Recalculate total
        if ('unit_price' in updates || 'quantity' in updates) {
            item.total_price = (item.unit_price || 0) * (item.quantity || 1);
        }
        
        newItems[index] = item;
        setItems(newItems);
    };

    const totalBudget = items.reduce((acc, item) => acc + item.total_price, 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tenant) return;

        try {
            setLoading(true);
            await dentalService.createBudget({
                patient_id: patientId,
                tenant_id: tenant.id,
                status: 'draft',
                total_amount: totalBudget,
                notes,
                valid_until: validUntil
            }, items);

            showToast('success', t('dentalModals.newBudget.toasts.created'));
            onSuccess();
            onClose();
        } catch (error: any) {
            showToast('error', t('dentalModals.newBudget.toasts.createErrorPrefix') + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-graphite-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-ice-100 animate-in zoom-in-95 duration-300">
                
                {/* Header */}
                <div className="p-8 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-graphite-900 tracking-tight">{t('dentalModals.newBudget.title')}</h2>
                            <p className="text-sm text-graphite-500 font-medium italic">{t('dentalModals.newBudget.subtitle')}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-ice-100 rounded-xl transition-colors border-none cursor-pointer text-graphite-400">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    
                    {/* Items Table */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-graphite-400 uppercase tracking-widest flex items-center gap-2">
                                <Plus size={14} className="text-brand-primary" />
                                {t('dentalModals.newBudget.itemsTitle')}
                            </h3>
                        </div>

                        <div className="border border-ice-200 rounded-2xl overflow-hidden">
                            <table className="w-full">
                                <thead className="bg-ice-50/50 border-b border-ice-100">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-[10px] font-black text-graphite-400 uppercase">{t('dentalModals.newBudget.table.toothFace')}</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black text-graphite-400 uppercase">{t('dentalModals.newBudget.table.procedure')}</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black text-graphite-400 uppercase w-32">{t('dentalModals.newBudget.table.unitValue')}</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black text-graphite-400 uppercase w-20">{t('dentalModals.newBudget.table.qty')}</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black text-graphite-400 uppercase w-32">{t('dentalModals.newBudget.table.total')}</th>
                                        <th className="px-4 py-3 text-center text-[10px] font-black text-graphite-400 uppercase w-12"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ice-100">
                                    {items.map((item, idx) => (
                                        <tr key={idx} className="group hover:bg-ice-50/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex gap-1">
                                                    <input 
                                                        type="number"
                                                        placeholder={t('dentalModals.newBudget.toothPlaceholder')}
                                                        value={item.tooth_number || ''}
                                                        onChange={(e) => updateItem(idx, { tooth_number: parseInt(e.target.value) })}
                                                        className="w-16 bg-ice-50/50 border border-ice-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:border-brand-primary outline-none"
                                                    />
                                                    <input 
                                                        type="text"
                                                        placeholder={t('dentalModals.newBudget.facePlaceholder')}
                                                        value={item.plane || ''}
                                                        onChange={(e) => updateItem(idx, { plane: e.target.value })}
                                                        className="w-16 bg-ice-50/50 border border-ice-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:border-brand-primary outline-none"
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <input 
                                                    type="text" 
                                                    required
                                                    placeholder={t('dentalModals.newBudget.procedureNamePlaceholder')}
                                                    value={item.procedure_name}
                                                    onChange={(e) => updateItem(idx, { procedure_name: e.target.value })}
                                                    className="w-full bg-ice-50/50 border border-ice-200 rounded-lg px-3 py-1.5 text-xs font-bold focus:border-brand-primary outline-none"
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="relative">
                                                    <DollarSign size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-graphite-400" />
                                                    <input 
                                                        type="number" 
                                                        required
                                                        value={item.unit_price}
                                                        onChange={(e) => updateItem(idx, { unit_price: parseFloat(e.target.value) })}
                                                        className="w-full bg-ice-50/50 border border-ice-200 rounded-lg pl-5 pr-2 py-1.5 text-xs font-bold focus:border-brand-primary outline-none"
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <input 
                                                    type="number" 
                                                    required
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(idx, { quantity: parseInt(e.target.value) })}
                                                    className="w-full bg-ice-50/50 border border-ice-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:border-brand-primary outline-none text-center"
                                                />
                                            </td>
                                            <td className="px-4 py-3 font-black text-xs text-graphite-900">
                                                {formatMoney(item.total_price)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button 
                                                    type="button"
                                                    onClick={() => removeItem(idx)}
                                                    className="p-1.5 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all border-none cursor-pointer"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button 
                            type="button"
                            onClick={addItem}
                            className="w-full py-3 border-2 border-dashed border-ice-200 rounded-2xl text-graphite-400 font-bold text-xs hover:border-brand-primary hover:text-brand-primary hover:bg-brand-primary/5 transition-all outline-none"
                        >
                            {t('dentalModals.newBudget.addItem')}
                        </button>
                    </div>

                    {/* Bottom Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Notes */}
                        <div className="space-y-2">
                             <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest px-1">{t('dentalModals.newBudget.notesLabel')}</label>
                             <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('dentalModals.newBudget.notesPlaceholder')}
                                className="w-full h-32 bg-ice-50/50 border border-ice-200 rounded-3xl p-4 text-sm font-medium focus:border-brand-primary outline-none resize-none"
                             />
                        </div>

                        {/* Summary & Expiry */}
                        <div className="bg-ice-50/30 rounded-[32px] p-8 border border-ice-100 flex flex-col justify-between">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('dentalModals.newBudget.validUntilLabel')}</label>
                                    <input 
                                        type="date"
                                        value={validUntil}
                                        onChange={(e) => setValidUntil(e.target.value)}
                                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2 mt-2 text-sm font-bold text-graphite-900 focus:border-brand-primary outline-none"
                                    />
                                </div>
                            </div>

                            <div className="pt-8 border-t border-ice-200 mt-8">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-graphite-400">{t('dentalModals.newBudget.subtotal')}</span>
                                    <span className="text-sm font-black text-graphite-900">{formatMoney(totalBudget)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-base font-black text-graphite-900">{t('dentalModals.newBudget.totalValue')}</span>
                                    <span className="text-2xl font-black text-brand-primary">{formatMoney(totalBudget)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </form>

                {/* Footer Actions */}
                <div className="p-8 border-t border-ice-100 flex justify-end gap-3 bg-ice-50/30">
                    <button 
                        type="button"
                        onClick={onClose}
                        className="px-6 py-3 rounded-2xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"
                    >
                        {t('dentalModals.newBudget.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="flex items-center gap-2 bg-brand-primary text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-brand-primary/20 hover:scale-105 transition-all border-none cursor-pointer disabled:opacity-50 disabled:scale-100"
                    >
                        {loading ? t('dentalModals.newBudget.saving') : (
                            <>
                                <Save size={18} />
                                <span>{t('dentalModals.newBudget.submit')}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
