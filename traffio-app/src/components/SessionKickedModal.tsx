import { useTranslation } from 'react-i18next';
import { AlertTriangle, LogIn } from 'lucide-react';

interface SessionKickedModalProps {
    onLogout: () => void;
}

/**
 * Modal NÃO-FECHÁVEL exibido quando a sessão do usuário é encerrada
 * devido a um login concorrente em outro dispositivo ou navegador.
 */
export const SessionKickedModal = ({ onLogout }: SessionKickedModalProps) => {
    const { t } = useTranslation('auth');
    return (
        <div className="fixed inset-0 z-[100] bg-graphite-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 md:p-10 border border-ice-100 animate-in fade-in zoom-in duration-300 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-500/10 text-amber-500 rounded-2xl mb-4">
                    <AlertTriangle size={28} />
                </div>
                <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('sessionKickedModal.title')}</h2>
                <p className="text-sm text-graphite-500 font-medium mb-6 leading-relaxed">
                    {t('sessionKickedModal.message')}
                </p>

                <button
                    onClick={onLogout}
                    className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer"
                >
                    <LogIn size={18} />
                    {t('sessionKickedModal.loginAgain')}
                </button>
            </div>
        </div>
    );
};
