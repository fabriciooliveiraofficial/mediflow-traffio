import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { useAuth } from '../contexts/AuthContext';

export const AppUpdatePrompt = () => {
    const { t } = useTranslation('common');
    const { session } = useAuth();
    const { updateAvailable, updating, applyUpdate, skipUpdate } = useAppUpdate();

    return (
        <AnimatePresence>
            {session && updateAvailable && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    className="fixed inset-0 z-[1200] flex items-center justify-center bg-graphite-900/40 backdrop-blur-sm p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="app-update-title"
                >
                    <motion.div
                        initial={{ scale: 0.94, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 12, transition: { duration: 0.15 } }}
                        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-ice-100 p-6"
                    >
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                                <RefreshCw size={22} className={updating ? 'animate-spin' : ''} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-brand-primary uppercase tracking-widest mb-1">
                                    {t('appUpdate.eyebrow')}
                                </p>
                                <h2 id="app-update-title" className="text-xl font-black text-graphite-900 tracking-tight leading-tight">
                                    {t('appUpdate.title')}
                                </h2>
                                <p className="mt-2 text-sm font-medium text-graphite-500 leading-relaxed">
                                    {t('appUpdate.description')}
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl bg-ice-50 border border-ice-100 px-4 py-3">
                            <p className="text-xs font-bold text-graphite-500 leading-relaxed">
                                {t('appUpdate.cacheNote')}
                            </p>
                        </div>

                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={skipUpdate}
                                disabled={updating}
                                className="flex-1 py-3 rounded-2xl font-bold text-graphite-700 bg-white hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('appUpdate.skip')}
                            </button>
                            <button
                                type="button"
                                onClick={applyUpdate}
                                disabled={updating}
                                className="flex-[1.4] py-3 rounded-2xl font-bold text-white bg-brand-primary shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] border-none transition-all cursor-pointer disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
                            >
                                <RefreshCw size={16} className={updating ? 'animate-spin' : ''} />
                                <span>{updating ? t('appUpdate.updating') : t('appUpdate.update')}</span>
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
