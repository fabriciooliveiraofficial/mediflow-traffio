import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle } from 'lucide-react';
import { LOST_REASON_LABEL_KEYS } from '../../lib/crmStages';

interface LostReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, notes?: string) => void;
  leadName?: string;
}

export function LostReasonModal({ isOpen, onClose, onConfirm, leadName }: LostReasonModalProps) {
  const { t } = useTranslation('crm');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!reason) {
      setError(t('lostReasonModal.errorSelectReason', 'Selecione um motivo para continuar.'));
      return;
    }
    setError('');
    onConfirm(reason, notes);
    
    // Reset state after confirmation
    setReason('');
    setNotes('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {t('lostReasonModal.title', 'Motivo da Perda')}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-600">
            {leadName 
              ? t('lostReasonModal.descriptionWithLead', 'Por que o lead {{name}} foi perdido?', { name: leadName })
              : t('lostReasonModal.description', 'Por favor, indique o motivo pelo qual este lead foi perdido. Essa informação é vital para nossas métricas.')}
          </p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
              {t('lostReasonModal.reasonLabel', 'Motivo')} <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(LOST_REASON_LABEL_KEYS).map(([key, labelKey]) => (
                <label
                  key={key}
                  className={`
                    flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                    ${reason === key 
                      ? 'border-red-500 bg-red-50 text-red-700' 
                      : 'border-gray-200 hover:border-red-300 hover:bg-red-50/50'}
                  `}
                >
                  <input
                    type="radio"
                    name="lostReason"
                    value={key}
                    checked={reason === key}
                    onChange={() => setReason(key)}
                    className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium">{t(labelKey)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
              {t('lostReasonModal.notesLabel', 'Observações Adicionais (Opcional)')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('lostReasonModal.notesPlaceholder', 'Detalhes adicionais sobre o motivo da perda...')}
              rows={3}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2.5 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20"
          >
            {t('common.confirm', 'Confirmar Perda')}
          </button>
        </div>
      </div>
    </div>
  );
}
