import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { useAuth } from '../contexts/AuthContext';

/**
 * Atualizações são aplicadas sozinhas assim que for seguro (sem campo de
 * texto focado, sem ligação em andamento — ver useAppUpdate.ts). Este
 * componente só aparece enquanto uma atualização estiver "adiada" esperando
 * esse momento seguro — não bloqueia a tela, e o único botão é pra quem
 * quiser aplicar na hora por conta própria.
 */
export const AppUpdatePrompt = () => {
    const { t } = useTranslation('common');
    const { session } = useAuth();
    const { updateDeferred, updating, applyUpdate } = useAppUpdate();

    return (
        <AnimatePresence>
            {session && updateDeferred && (
                <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.15 } }}
                    className="fixed bottom-6 right-6 z-[1200] max-w-xs w-full bg-white rounded-2xl shadow-2xl border border-ice-100 p-4"
                    role="status"
                >
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                            <RefreshCw size={18} className={updating ? 'animate-spin' : ''} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-black text-graphite-900 leading-tight">
                                {t('appUpdate.title')}
                            </p>
                            <p className="mt-1 text-xs font-medium text-graphite-500 leading-relaxed">
                                {t('appUpdate.deferredDescription')}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={applyUpdate}
                        disabled={updating}
                        className="mt-3 w-full py-2.5 rounded-xl font-bold text-sm text-white bg-brand-primary shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] border-none transition-all cursor-pointer disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
                    >
                        <RefreshCw size={14} className={updating ? 'animate-spin' : ''} />
                        <span>{updating ? t('appUpdate.updating') : t('appUpdate.update')}</span>
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
