import React, { useState, useEffect } from 'react';
import { 
    X, 
    CreditCard, 
    Building2, 
    Check, 
    ChevronRight, 
    ShieldCheck,
    CheckCircle2,
    Loader2,
    Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { drCashService } from '../services/drCashService';
import { useToast } from '../contexts/ToastContext';

interface CheckoutModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientId: string;
    patientName: string;
    initialAmount: number;
    tenantId: string;
}

type PaymentMethod = 'credit_card' | 'financing';

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
    isOpen,
    onClose,
    patientId,
    patientName,
    initialAmount,
    tenantId
}) => {
    const { showToast } = useToast();
    const [method, setMethod] = useState<PaymentMethod>('credit_card');
    const [amount, setAmount] = useState(initialAmount);
    const [installments, setInstallments] = useState(1);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    // Reset state on open/close
    useEffect(() => {
        if (isOpen) {
            setSuccess(false);
            setLoading(false);
            setAmount(initialAmount);
            setInstallments(1);
        }
    }, [isOpen, initialAmount]);

    const handleExecutePayment = async () => {
        setLoading(true);
        try {
            if (method === 'financing') {
                // Execute Dr. Cash Flow
                await drCashService.createProposal(
                    tenantId,
                    patientId,
                    amount,
                    installments,
                    { full_name: patientName } // Simplified patient data for demo
                );
                
                showToast('success', 'Proposta de financiamento enviada com sucesso!');
                setSuccess(true);
            } else {
                // Execute Pagar.me Flow (Simulation for now)
                await new Promise(resolve => setTimeout(resolve, 2000));
                showToast('success', 'Checkout Pagar.me iniciado!');
                setSuccess(true);
            }
        } catch (error: any) {
            showToast('error', error.message || 'Erro ao processar pagamento.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-graphite-900/60 backdrop-blur-md"
            />
            
            <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 30 }}
                className="relative bg-white w-full max-w-xl rounded-[48px] shadow-2xl overflow-hidden border border-ice-100"
            >
                {/* Header */}
                <div className="p-8 border-b border-ice-50 flex items-center justify-between">
                    <div>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tight">Receber Pagamento</h3>
                        <p className="text-sm text-graphite-400 font-medium">Paciente: <span className="text-graphite-900 font-bold">{patientName}</span></p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-3 hover:bg-ice-50 rounded-2xl transition-colors text-graphite-400"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-10 space-y-8">
                    <AnimatePresence mode="wait">
                        {!success ? (
                            <motion.div 
                                key="form"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-8"
                            >
                                {/* Step Indicators if complex, else just amount box */}
                                <div className="bg-brand-primary/5 p-6 rounded-3xl border border-brand-primary/10 text-center">
                                    <p className="text-[10px] font-black text-brand-primary uppercase tracking-widest mb-1">Valor a Receber</p>
                                    <div className="flex items-center justify-center gap-2">
                                        <span className="text-lg font-bold text-brand-primary mt-2">R$</span>
                                        <input 
                                            type="number" 
                                            value={amount}
                                            onChange={(e) => setAmount(Number(e.target.value))}
                                            className="bg-transparent border-none text-4xl font-black text-graphite-900 w-40 text-center focus:outline-none focus:ring-0"
                                        />
                                    </div>
                                </div>

                                {/* Method Selection */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <button 
                                        onClick={() => setMethod('credit_card')}
                                        className={`p-6 rounded-[32px] border-2 text-left transition-all relative overflow-hidden group ${
                                            method === 'credit_card' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-200'
                                        }`}
                                    >
                                        <div className={`p-3 w-fit rounded-2xl mb-4 ${method === 'credit_card' ? 'bg-brand-primary text-white' : 'bg-ice-50 text-graphite-400'}`}>
                                            <CreditCard size={24} />
                                        </div>
                                        <h4 className="font-black text-graphite-900 mb-1">Cartão de Crédito</h4>
                                        <p className="text-[10px] font-bold text-graphite-400 uppercase tracking-tighter">Até 21x Parcelado</p>
                                        {method === 'credit_card' && <div className="absolute top-4 right-4 text-brand-primary"><CheckCircle2 size={20} /></div>}
                                    </button>

                                    <button 
                                        onClick={() => setMethod('financing')}
                                        className={`p-6 rounded-[32px] border-2 text-left transition-all relative overflow-hidden group ${
                                            method === 'financing' ? 'border-emerald-500 bg-emerald-500/5' : 'border-ice-100 hover:border-ice-200'
                                        }`}
                                    >
                                        <div className={`p-3 w-fit rounded-2xl mb-4 ${method === 'financing' ? 'bg-emerald-500 text-white' : 'bg-ice-50 text-graphite-400'}`}>
                                            <Building2 size={24} />
                                        </div>
                                        <h4 className="font-black text-graphite-900 mb-1">Financiamento</h4>
                                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-tighter">Até 24x sem Cartão</p>
                                        {method === 'financing' && <div className="absolute top-4 right-4 text-emerald-500"><CheckCircle2 size={20} /></div>}
                                    </button>
                                </div>

                                {/* Simulation Area */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wider">Número de Parcelas</label>
                                        <span className="text-xs font-bold text-brand-primary">{installments}x de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount / installments)}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max={method === 'credit_card' ? 21 : 24}
                                        value={installments}
                                        onChange={(e) => setInstallments(Number(e.target.value))}
                                        className="w-full h-2 bg-ice-100 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                    />
                                    <div className="flex justify-between text-[10px] font-black text-graphite-300">
                                        <span>1x</span>
                                        <span>{method === 'credit_card' ? 21 : 24}x</span>
                                    </div>
                                </div>

                                {/* Action Button */}
                                <button 
                                    onClick={handleExecutePayment}
                                    disabled={loading}
                                    className={`w-full py-6 rounded-[24px] font-black text-lg transition-all flex items-center justify-center gap-3 border-none cursor-pointer shadow-xl ${
                                        method === 'credit_card' 
                                            ? 'bg-brand-primary text-white shadow-brand-primary/20' 
                                            : 'bg-emerald-500 text-white shadow-emerald-500/20'
                                    } hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50`}
                                >
                                    {loading ? <Loader2 className="animate-spin" size={24} /> : (
                                        <>
                                            {method === 'credit_card' ? <Plus size={24} /> : <ChevronRight size={24} />}
                                            <span>{method === 'credit_card' ? 'Gerar Link de Pagamento' : 'Enviar Estudo Dr. Cash'}</span>
                                        </>
                                    )}
                                </button>
                            </motion.div>
                        ) : (
                            <motion.div 
                                key="success"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="py-12 flex flex-col items-center text-center space-y-6"
                            >
                                <div className={`w-24 h-24 rounded-full flex items-center justify-center shadow-xl ${
                                    method === 'credit_card' ? 'bg-brand-primary text-white' : 'bg-emerald-500 text-white'
                                }`}>
                                    <Check size={48} />
                                </div>
                                <div className="space-y-2">
                                    <h4 className="text-2xl font-black text-graphite-900">Operação Iniciada!</h4>
                                    <p className="text-sm text-graphite-500 font-medium max-w-xs mx-auto">
                                        {method === 'credit_card' 
                                            ? 'Aguardando o paciente processar o pagamento no cartão via link.' 
                                            : 'O paciente recebeu o link da proposta no celular para análise de crédito.'}
                                    </p>
                                </div>
                                <button 
                                    onClick={onClose}
                                    className="px-8 py-3 bg-ice-50 text-graphite-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-ice-100 transition-all border-none cursor-pointer"
                                >
                                    Fechar Janela
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Security Badge */}
                <div className="bg-ice-25 p-6 flex justify-center items-center gap-3">
                    <ShieldCheck size={18} className="text-emerald-500" />
                    <span className="text-[10px] font-black text-graphite-400 uppercase tracking-widest flex items-center gap-2">
                        Ambiente Seguro PCI-DSS 
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Criptografia SSL
                    </span>
                </div>
            </motion.div>
        </div>
    );
};
