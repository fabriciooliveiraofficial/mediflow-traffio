import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, ClipboardList, Printer, Calendar, Hash } from 'lucide-react';
import { useLocaleFormat } from '../hooks/useLocaleFormat';

interface Medication {
    name: string;
    dosage: string;
    instructions: string;
}

interface ViewPrescriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    prescription: any;
}

export const ViewPrescriptionModal: React.FC<ViewPrescriptionModalProps> = ({
    isOpen,
    onClose,
    prescription
}) => {
    const { t } = useTranslation('medical');
    const { formatDate } = useLocaleFormat();

    if (!isOpen || !prescription) return null;

    const medications: Medication[] = prescription.content_json?.medications || [];

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
            />

            {/* Modal */}
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-white pointer-events-auto w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden border border-white/20 flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                                <ClipboardList size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-graphite-900 tracking-tight">
                                    {t('viewPrescriptionModal.title')}
                                </h3>
                                <div className="flex items-center gap-3 mt-0.5">
                                    <span className="flex items-center gap-1 text-[10px] font-bold text-graphite-400 uppercase tracking-wider">
                                        <Calendar size={12} />
                                        {formatDate(prescription.created_at)}
                                    </span>
                                    <span className="flex items-center gap-1 text-[10px] font-bold text-graphite-400 uppercase tracking-wider">
                                        <Hash size={12} />
                                        {t('viewPrescriptionModal.idPrefix', { id: prescription.id.slice(0, 8) })}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary hover:border-brand-primary/30 transition-all cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
                        {/* Prescription Body (Print-like style) */}
                        <div className="bg-ice-50/50 rounded-[24px] border border-ice-100 p-8 space-y-8">
                            {/* Medical Symbol or Logo Placeholder */}
                            <div className="flex justify-center opacity-10">
                                <ClipboardList size={64} className="text-brand-primary" />
                            </div>

                            <div className="space-y-6">
                                <h4 className="text-xs font-black text-brand-primary uppercase tracking-[0.2em] text-center border-b border-ice-200 pb-4">
                                    {t('viewPrescriptionModal.prescriptionHeading')}
                                </h4>

                                <div className="space-y-6">
                                    {medications.length === 0 ? (
                                        <p className="text-sm text-graphite-400 italic text-center">{t('viewPrescriptionModal.noMedications')}</p>
                                    ) : (
                                        medications.map((med, idx) => (
                                            <div key={idx} className="space-y-2 border-b border-dashed border-ice-200 pb-6 last:border-0">
                                                <div className="flex items-start gap-3">
                                                    <span className="text-sm font-black text-graphite-900 mt-0.5">{idx + 1}.</span>
                                                    <div className="space-y-1">
                                                        <p className="text-base font-black text-graphite-900 uppercase tracking-tight">{med.name}</p>
                                                        <p className="text-sm font-bold text-brand-primary">{med.dosage}</p>
                                                        <p className="text-sm text-graphite-500 font-medium italic">{med.instructions}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Sign Area */}
                            <div className="pt-12 border-t border-ice-200 mt-12">
                                <div className="max-w-[200px] mx-auto text-center space-y-1">
                                    <div className="h-px bg-graphite-200 mb-4" />
                                    <p className="text-[10px] font-black text-graphite-900 uppercase">{t('viewPrescriptionModal.signatureLabel')}</p>
                                    <p className="text-[9px] font-bold text-graphite-400 tracking-wider">{t('viewPrescriptionModal.digitalDocument')}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-8 border-t border-ice-100 bg-ice-50/30 flex gap-4">
                        <button
                            onClick={onClose}
                            className="flex-1 py-4 rounded-2xl font-bold text-graphite-700 hover:bg-white border border-ice-200 transition-all cursor-pointer"
                        >
                            {t('viewPrescriptionModal.close')}
                        </button>
                        <button
                            onClick={() => window.print()}
                            className="flex-1 bg-graphite-900 text-white py-4 rounded-2xl font-black shadow-xl shadow-graphite-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer"
                        >
                            <Printer size={18} />
                            <span>{t('viewPrescriptionModal.printPdf')}</span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};
