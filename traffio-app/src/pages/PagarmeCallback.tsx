import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export const PagarmeCallback = () => {
    const { t } = useTranslation('billing');
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState(t('pagarmeCallback.connecting'));

    useEffect(() => {
        const handleCallback = async () => {
            const code = searchParams.get('code');
            const error = searchParams.get('error');

            if (error || !code) {
                setStatus('error');
                setMessage(t('pagarmeCallback.authorizationFailed'));
                showToast('error', t('pagarmeCallback.connectionFailedToast'));
                return;
            }

            if (!tenant?.id) {
                // Wait a bit for tenant context to load if needed
                setTimeout(() => {
                    if (!tenant?.id) {
                        setStatus('error');
                        setMessage(t('pagarmeCallback.tenantNotIdentified'));
                    }
                }, 2000);
                return;
            }

            try {
                // Call the secure Edge Function for token exchange
                const { data, error: functionError } = await supabase.functions.invoke('pagarme-oauth', {
                    body: {
                        code,
                        tenant_id: tenant.id,
                        is_sandbox: false // Handle environment logic here
                    }
                });

                if (functionError) throw functionError;

                setStatus('success');
                setMessage(t('pagarmeCallback.successRedirecting'));
                showToast('success', t('pagarmeCallback.connectedToast'));

                // Redirect back to settings after a visual confirmation
                setTimeout(() => {
                    navigate('/dashboard/settings');
                }, 2000);

            } catch (err) {
                console.error('OAuth Error:', err);
                setStatus('error');
                setMessage(t('pagarmeCallback.tokenExchangeError'));
                showToast('error', t('pagarmeCallback.internalErrorToast'));
            }
        };

        handleCallback();
    }, [searchParams, tenant, navigate, showToast, t]);

    return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-6">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full bg-white rounded-[40px] shadow-2xl p-12 text-center space-y-8 border border-ice-100"
            >
                <div className="flex justify-center">
                    <div className={`p-6 rounded-3xl ${
                        status === 'loading' ? 'bg-brand-primary/5 text-brand-primary' :
                        status === 'success' ? 'bg-emerald-50 text-emerald-600' :
                        'bg-rose-50 text-rose-600'
                    }`}>
                        {status === 'loading' && <Loader2 size={48} className="animate-spin" />}
                        {status === 'success' && <CheckCircle2 size={48} />}
                        {status === 'error' && <AlertCircle size={48} />}
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-2xl font-black text-graphite-900 tracking-tight">
                        {status === 'loading' && t('pagarmeCallback.titleLoading')}
                        {status === 'success' && t('pagarmeCallback.titleSuccess')}
                        {status === 'error' && t('pagarmeCallback.titleError')}
                    </h2>
                    <p className="text-graphite-500 font-medium leading-relaxed">
                        {message}
                    </p>
                </div>

                <div className="pt-4 flex flex-col items-center gap-4">
                    <div className="flex items-center gap-2 text-[10px] font-black text-graphite-300 uppercase tracking-widest bg-ice-50 px-4 py-2 rounded-full">
                        <Shield size={12} />
                        {t('pagarmeCallback.sslEncrypted')}
                    </div>

                    {status === 'error' && (
                        <button
                            onClick={() => navigate('/dashboard/settings')}
                            className="text-sm font-bold text-brand-primary hover:underline"
                        >
                            {t('pagarmeCallback.backToSettings')}
                        </button>
                    )}
                </div>
            </motion.div>
        </div>
    );
};
