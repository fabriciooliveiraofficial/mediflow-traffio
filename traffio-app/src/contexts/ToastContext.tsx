import React, { createContext, useContext, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
}

interface ConfirmState {
    message: string;
    resolve: (value: boolean) => void;
}

interface ToastContextType {
    showToast: (type: ToastType, message: string) => void;
    showConfirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

    const showToast = useCallback((type: ToastType, message: string) => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts(prev => [...prev, { id, type, message }]);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const showConfirm = useCallback((message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            setConfirmState({ message, resolve });
        });
    }, []);

    const handleConfirmResponse = useCallback((value: boolean) => {
        confirmState?.resolve(value);
        setConfirmState(null);
    }, [confirmState]);

    return (
        <ToastContext.Provider value={{ showToast, showConfirm }}>
            {children}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 pointer-events-none">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <ToastComponent key={toast.id} toast={toast} />
                    ))}
                </AnimatePresence>
            </div>
            <AnimatePresence>
                {confirmState && (
                    <ConfirmDialog
                        message={confirmState.message}
                        onConfirm={() => handleConfirmResponse(true)}
                        onCancel={() => handleConfirmResponse(false)}
                    />
                )}
            </AnimatePresence>
        </ToastContext.Provider>
    );
};

// Internal component for animation and styling
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';
import { clsx } from 'clsx';

const ToastComponent: React.FC<{ toast: Toast }> = ({ toast }) => {
    const icons = {
        success: <CheckCircle2 size={18} />,
        error: <XCircle size={18} />,
        warning: <AlertTriangle size={18} />,
        info: <Info size={18} />
    };

    const styles = {
        success: "bg-emerald-500 text-white shadow-emerald-200/50",
        error: "bg-rose-500 text-white shadow-rose-200/50",
        warning: "bg-amber-500 text-white shadow-amber-200/50",
        info: "bg-brand-primary text-white shadow-brand-primary/20"
    };

    return (
        <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={clsx(
                "px-6 py-3 rounded-2xl shadow-xl text-sm font-bold flex items-center gap-3 backdrop-blur-md",
                styles[toast.type]
            )}
        >
            <span className="shrink-0">{icons[toast.type]}</span>
            <span>{toast.message}</span>
        </motion.div>
    );
};

const ConfirmDialog: React.FC<{ message: string; onConfirm: () => void; onCancel: () => void }> = ({ message, onConfirm, onCancel }) => {
    const { t } = useTranslation('common');
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={onCancel}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10, transition: { duration: 0.15 } }}
                onClick={e => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4"
            >
                <div className="flex items-start gap-3 mb-5">
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-500 shrink-0">
                        <AlertTriangle size={20} />
                    </div>
                    <p className="text-sm text-gray-700 font-medium leading-relaxed pt-1.5">{message}</p>
                </div>
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                    >
                        {t('actions.cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-xl transition-colors"
                    >
                        {t('actions.confirm')}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
