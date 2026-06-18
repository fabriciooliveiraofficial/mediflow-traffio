import { useState, useEffect } from 'react';
import { CreditCard, Building2, Shield, Key, Check, ExternalLink, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';

export const PaymentsPage = () => {
    const { showToast } = useToast();
    const { formatDate } = useLocaleFormat();
    const [tenants, setTenants] = useState<any[]>([]);
    const [paymentConfig, setPaymentConfig] = useState({
        asaas_api_key: '',
        drcash_api_key: '',
        enable_cc: false,
        enable_financing: false,
    });
    const [proposals, setProposals] = useState<any[]>([]);
    const [savingAsaas, setSavingAsaas] = useState(false);
    const [savingDrcash, setSavingDrcash] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        const { data: tenantsData } = await supabase.from('tenants').select('*');
        if (!tenantsData) return;
        setTenants(tenantsData);

        if (tenantsData.length > 0) {
            const t = tenantsData[0];
            setPaymentConfig({
                asaas_api_key: t.asaas_api_key || '',
                drcash_api_key: t.drcash_api_key || '',
                enable_cc: t.payment_config?.enable_cc || false,
                enable_financing: t.payment_config?.enable_financing || false,
            });

            const { data: propData } = await supabase
                .from('financing_proposals')
                .select('*, patients(full_name)')
                .eq('tenant_id', t.id)
                .order('created_at', { ascending: false })
                .limit(5);
            setProposals(propData || []);
        }
    };

    const handleSaveAsaas = async () => {
        if (!tenants[0]?.id || !paymentConfig.asaas_api_key) return;
        setSavingAsaas(true);
        try {
            const { error } = await supabase
                .from('tenants')
                .update({
                    asaas_api_key: paymentConfig.asaas_api_key,
                    payment_config: {
                        enable_cc: true,
                        enable_financing: !!paymentConfig.drcash_api_key,
                    },
                })
                .eq('id', tenants[0].id);
            if (error) throw error;
            showToast('success', 'Chave Asaas salva com sucesso!');
            fetchData();
        } catch {
            showToast('error', 'Erro ao salvar configurações do Asaas.');
        } finally {
            setSavingAsaas(false);
        }
    };

    const handleSaveDrcash = async () => {
        if (!tenants[0]?.id || !paymentConfig.drcash_api_key) return;
        setSavingDrcash(true);
        try {
            const { error } = await supabase
                .from('tenants')
                .update({
                    drcash_api_key: paymentConfig.drcash_api_key,
                    payment_config: {
                        enable_cc: !!paymentConfig.asaas_api_key,
                        enable_financing: true,
                    },
                })
                .eq('id', tenants[0].id);
            if (error) throw error;
            showToast('success', 'Configurações Dr. Cash salvas!');
            fetchData();
        } catch {
            showToast('error', 'Erro ao salvar configurações de financiamento.');
        } finally {
            setSavingDrcash(false);
        }
    };

    const isAsaasConnected = !!paymentConfig.asaas_api_key;
    const isDrcashConnected = !!paymentConfig.drcash_api_key;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Hub de Pagamentos</h1>
                    <p className="text-graphite-500 font-medium">Configure como sua clínica recebe pagamentos e oferece financiamento.</p>
                </div>
                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full text-xs font-bold ring-1 ring-emerald-100">
                    <Shield size={14} />
                    <span>Ambiente Seguro PCI-DSS</span>
                </div>
            </div>

            {/* Gateway Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Asaas Card */}
                <div className={`group bg-white border-2 rounded-[32px] p-8 space-y-6 transition-all relative overflow-hidden ${isAsaasConnected ? 'border-blue-500 shadow-xl shadow-blue-500/10' : 'border-ice-100 hover:border-blue-200 hover:shadow-lg'}`}>
                    <div className={`absolute top-0 left-0 w-full h-1.5 transition-colors ${isAsaasConnected ? 'bg-blue-500' : 'bg-blue-500/10'}`} />

                    <div className="flex justify-between items-start">
                        <div className={`p-4 rounded-2xl ${isAsaasConnected ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-blue-50 text-blue-500'}`}>
                            <CreditCard size={32} />
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                            <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">Cartão de Crédito</span>
                            {isAsaasConnected ? (
                                <span className="flex items-center gap-1.5 text-emerald-600 font-black uppercase text-[10px] bg-emerald-50 px-2 py-1 rounded-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                    Ativo
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 text-amber-500 font-black uppercase text-[10px] bg-amber-50 px-2 py-1 rounded-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    Não conectado
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <h4 className="text-xl font-black text-graphite-900">Asaas</h4>
                        <p className="text-sm text-graphite-500 leading-relaxed font-medium">
                            Conta digital completa para clínicas. Aceite cartões com parcelamento em <strong>até 21x</strong> (Visa/Master) com subcontas independentes por clínica via API.
                        </p>
                    </div>

                    {/* Feature pills */}
                    <div className="flex flex-wrap gap-2">
                        {['21x Visa/Master', 'Subcontas API', 'White Label', 'Pix nativo', 'Boleto'].map((f) => (
                            <span key={f} className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">{f}</span>
                        ))}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-ice-50">
                        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-tighter block">
                            Chave de API Asaas
                        </label>
                        <div className="relative">
                            <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-graphite-300 pointer-events-none" />
                            <input
                                type="password"
                                value={paymentConfig.asaas_api_key}
                                onChange={(e) => setPaymentConfig({ ...paymentConfig, asaas_api_key: e.target.value })}
                                placeholder="$aact_prod_..."
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleSaveAsaas}
                            disabled={!paymentConfig.asaas_api_key || savingAsaas}
                            className={`w-full py-3.5 rounded-2xl font-black transition-all flex items-center justify-center gap-2 border-none ${
                                paymentConfig.asaas_api_key
                                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                                    : 'bg-ice-100 text-graphite-400 cursor-not-allowed'
                            }`}
                        >
                            {isAsaasConnected ? <Check size={18} /> : <Key size={18} />}
                            <span>{savingAsaas ? 'Salvando...' : isAsaasConnected ? 'Atualizar Chave' : 'Ativar Asaas'}</span>
                        </button>
                        <a
                            href="https://www.asaas.com/cadastrarConta"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 text-[10px] text-blue-500 font-bold hover:underline"
                        >
                            <ExternalLink size={11} />
                            Criar conta gratuita no Asaas
                        </a>
                    </div>
                </div>

                {/* Dr. Cash Card */}
                <div className={`group bg-white border-2 rounded-[32px] p-8 space-y-6 transition-all relative overflow-hidden ${isDrcashConnected ? 'border-emerald-500 shadow-xl shadow-emerald-500/10' : 'border-ice-100 hover:border-emerald-200 hover:shadow-lg'}`}>
                    <div className={`absolute top-0 left-0 w-full h-1.5 transition-colors ${isDrcashConnected ? 'bg-emerald-500' : 'bg-emerald-500/10'}`} />

                    <div className="flex justify-between items-start">
                        <div className={`p-4 rounded-2xl ${isDrcashConnected ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-emerald-50 text-emerald-600'}`}>
                            <Building2 size={32} />
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                            <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">Boleto Parcelado</span>
                            {isDrcashConnected ? (
                                <span className="flex items-center gap-1.5 text-emerald-600 font-black uppercase text-[10px] bg-emerald-50 px-2 py-1 rounded-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                    Ativo
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 text-amber-500 font-black uppercase text-[10px] bg-amber-50 px-2 py-1 rounded-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    Não conectado
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <h4 className="text-xl font-black text-graphite-900">Dr. Cash / Dr. Parcela</h4>
                        <p className="text-sm text-graphite-500 leading-relaxed font-medium">
                            Especialista em saúde. Ofereça financiamento em <strong>até 24x no boleto</strong> sem comprometer o limite do cartão do paciente.
                        </p>
                    </div>

                    {/* Feature pills */}
                    <div className="flex flex-wrap gap-2">
                        {['24x no boleto', 'Saúde especializado', 'Sem comprometer cartão', 'Aprovação facilitada'].map((f) => (
                            <span key={f} className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">{f}</span>
                        ))}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-ice-50">
                        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-tighter block">
                            Chave API / Identificador
                        </label>
                        <div className="relative">
                            <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-graphite-300 pointer-events-none" />
                            <input
                                type="password"
                                value={paymentConfig.drcash_api_key}
                                onChange={(e) => setPaymentConfig({ ...paymentConfig, drcash_api_key: e.target.value })}
                                placeholder="Insira sua Chave Dr. Cash"
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-4 py-3 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleSaveDrcash}
                            disabled={!paymentConfig.drcash_api_key || savingDrcash}
                            className={`w-full py-3.5 rounded-2xl font-black transition-all flex items-center justify-center gap-2 border-none ${
                                paymentConfig.drcash_api_key
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                                    : 'bg-ice-100 text-graphite-400 cursor-not-allowed'
                            }`}
                        >
                            {isDrcashConnected ? <Check size={18} /> : <Shield size={18} />}
                            <span>{savingDrcash ? 'Salvando...' : isDrcashConnected ? 'Atualizar Chave' : 'Ativar Financiamento'}</span>
                        </button>
                        <p className="text-[10px] text-center text-graphite-400 font-bold">
                            Você precisará de uma conta aprovada com a Dr. Cash para ativar.
                        </p>
                    </div>
                </div>
            </div>

            {/* Asaas info note */}
            <div className="flex items-start gap-3 p-5 bg-blue-50/60 rounded-2xl border border-blue-100">
                <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-sm text-graphite-600 font-medium leading-relaxed">
                    <strong className="text-blue-600">Como funciona a integração Asaas:</strong> ao salvar sua chave de API, a Traffio cria automaticamente uma <strong>subconta Asaas</strong> para cada clínica cadastrada. As cobranças são emitidas em nome da clínica (white label), sem expor a marca Asaas ao paciente. Obtenha sua chave em <strong>Minha Conta → Configurações → Chaves de API</strong> no painel Asaas.
                </p>
            </div>

            {/* Proposals History */}
            {proposals.length > 0 && (
                <div className="bg-white border border-ice-100 rounded-[32px] p-8 space-y-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h4 className="text-xl font-black text-graphite-900">Histórico de Propostas</h4>
                            <p className="text-sm text-graphite-400 font-medium tracking-tight">Últimas requisições de financiamento via Dr. Cash.</p>
                        </div>
                        <button className="text-xs font-black text-brand-primary uppercase tracking-widest hover:underline px-4 py-2 bg-ice-50 rounded-full">Ver Tudo</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-ice-50">
                                    <th className="pb-4 text-[10px] font-black text-graphite-400 uppercase tracking-tighter">Paciente</th>
                                    <th className="pb-4 text-[10px] font-black text-graphite-400 uppercase tracking-tighter">Valor</th>
                                    <th className="pb-4 text-[10px] font-black text-graphite-400 uppercase tracking-tighter">Parcelas</th>
                                    <th className="pb-4 text-[10px] font-black text-graphite-400 uppercase tracking-tighter">Status</th>
                                    <th className="pb-4 text-[10px] font-black text-graphite-400 uppercase tracking-tighter">Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                {proposals.map((prop) => (
                                    <tr key={prop.id} className="border-b border-ice-100 last:border-0">
                                        <td className="py-4">
                                            <div className="font-bold text-graphite-700 text-sm">{prop.patients?.full_name || 'Paciente Externo'}</div>
                                            <div className="text-[10px] text-graphite-400 font-mono">#{prop.id.slice(0, 8)}</div>
                                        </td>
                                        <td className="py-4 font-black text-graphite-900 text-sm">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prop.amount)}
                                        </td>
                                        <td className="py-4">
                                            <span className="bg-ice-50 text-graphite-500 px-2.5 py-1 rounded-lg text-[10px] font-black">{prop.installments}x</span>
                                        </td>
                                        <td className="py-4">
                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                                prop.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600' :
                                                prop.status === 'PENDING'  ? 'bg-amber-50 text-amber-600' :
                                                prop.status === 'REJECTED' ? 'bg-rose-50 text-rose-600' :
                                                'bg-ice-100 text-graphite-400'
                                            }`}>
                                                {prop.status}
                                            </span>
                                        </td>
                                        <td className="py-4 text-xs font-bold text-graphite-400 whitespace-nowrap">
                                            {formatDate(prop.created_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-ice-50 p-6 rounded-2xl border border-ice-100">
                    <h5 className="text-sm font-bold text-graphite-900 mb-2">Subcontas Automáticas</h5>
                    <p className="text-xs text-graphite-500 leading-relaxed font-medium">Cada clínica cadastrada na Traffio recebe sua própria subconta Asaas criada via API — sem burocracia manual.</p>
                </div>
                <div className="bg-ice-50 p-6 rounded-2xl border border-ice-100">
                    <h5 className="text-sm font-bold text-graphite-900 mb-2">Parcelamento em até 21x</h5>
                    <p className="text-xs text-graphite-500 leading-relaxed font-medium">Cartões Visa e Mastercard aceitam até 21 parcelas. Combine com Dr. Cash para oferecer 24x no boleto sem depender do limite do cartão.</p>
                </div>
                <div className="bg-ice-50 p-6 rounded-2xl border border-ice-100">
                    <h5 className="text-sm font-bold text-graphite-900 mb-2">White Label Nativo</h5>
                    <p className="text-xs text-graphite-500 leading-relaxed font-medium">Cobranças emitidas sempre em nome da clínica. O paciente vê a marca da clínica — nunca a marca Asaas ou Traffio.</p>
                </div>
            </div>
        </div>
    );
};
