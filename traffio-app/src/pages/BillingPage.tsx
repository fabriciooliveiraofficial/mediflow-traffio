import { Shield, Check, Zap, Star, Crown } from 'lucide-react';

const plans = [
    {
        id: 'starter',
        name: 'Starter',
        price: 'R$ 199',
        period: '/mês',
        description: 'Ideal para clínicas menores que estão começando.',
        icon: Star,
        color: 'brand-primary',
        features: [
            'Até 2 profissionais',
            '1 unidade',
            'Agenda inteligente',
            'WhatsApp Bot básico',
            'Suporte por e-mail',
        ],
        cta: 'Plano Atual',
        current: true,
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 'R$ 499',
        period: '/mês',
        description: 'Para clínicas em crescimento com múltiplos profissionais.',
        icon: Zap,
        color: 'indigo-500',
        features: [
            'Até 10 profissionais',
            'Múltiplas unidades',
            'IA de Inteligência completa',
            'WhatsApp Bot avançado + CRM',
            'Hub de Pagamentos',
            'Suporte prioritário',
        ],
        cta: 'Fazer Upgrade',
        current: false,
    },
    {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Sob consulta',
        period: '',
        description: 'Soluções personalizadas para grandes redes e hospitais.',
        icon: Crown,
        color: 'amber-500',
        features: [
            'Profissionais ilimitados',
            'Unidades ilimitadas',
            'API dedicada',
            'SLA garantido 99.9%',
            'Gerente de sucesso exclusivo',
            'Implantação assistida',
        ],
        cta: 'Falar com Vendas',
        current: false,
    },
];

export const BillingPage = () => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Assinatura</h1>
                <p className="text-graphite-500 font-medium">Gerencie seu plano e faturamento da plataforma Traffio Med.</p>
            </div>

            {/* Current Plan Banner */}
            <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-[32px] p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-brand-primary rounded-2xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                        <Star size={28} className="text-white" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-brand-primary uppercase tracking-widest mb-1">Plano Ativo</p>
                        <h2 className="text-2xl font-black text-graphite-900">Starter</h2>
                        <p className="text-sm text-graphite-500 font-medium">Renova em 15/05/2026 · R$ 199/mês</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-emerald-600 font-black text-xs bg-emerald-50 px-3 py-1.5 rounded-full ring-1 ring-emerald-100">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        Ativo
                    </span>
                    <button className="px-5 py-2.5 rounded-xl border border-ice-200 text-graphite-600 text-sm font-bold hover:bg-ice-50 transition-colors">
                        Gerenciar Faturamento
                    </button>
                </div>
            </div>

            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => {
                    const Icon = plan.icon;
                    return (
                        <div
                            key={plan.id}
                            className={`relative bg-white rounded-[32px] p-8 border-2 transition-all flex flex-col ${
                                plan.current
                                    ? 'border-brand-primary shadow-xl shadow-brand-primary/10'
                                    : 'border-ice-100 hover:border-ice-200 hover:shadow-lg'
                            }`}
                        >
                            {plan.current && (
                                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-primary text-white text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest">
                                    Seu Plano
                                </div>
                            )}

                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${
                                plan.id === 'starter' ? 'bg-brand-primary/10 text-brand-primary' :
                                plan.id === 'pro' ? 'bg-indigo-50 text-indigo-500' :
                                'bg-amber-50 text-amber-500'
                            }`}>
                                <Icon size={24} />
                            </div>

                            <h3 className="text-xl font-black text-graphite-900 mb-1">{plan.name}</h3>
                            <p className="text-xs text-graphite-400 font-medium mb-4 leading-relaxed">{plan.description}</p>

                            <div className="mb-6">
                                <span className="text-3xl font-black text-graphite-900">{plan.price}</span>
                                <span className="text-graphite-400 font-medium text-sm">{plan.period}</span>
                            </div>

                            <ul className="space-y-3 flex-1 mb-8">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                                            plan.id === 'starter' ? 'bg-brand-primary/10 text-brand-primary' :
                                            plan.id === 'pro' ? 'bg-indigo-50 text-indigo-500' :
                                            'bg-amber-50 text-amber-500'
                                        }`}>
                                            <Check size={12} />
                                        </div>
                                        <span className="text-sm text-graphite-600 font-medium">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <button
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all border-none cursor-pointer ${
                                    plan.current
                                        ? 'bg-ice-100 text-graphite-400 cursor-default'
                                        : plan.id === 'pro'
                                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98]'
                                        : 'bg-graphite-900 text-white hover:scale-[1.02] active:scale-[0.98]'
                                }`}
                                disabled={plan.current}
                            >
                                {plan.cta}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Security Note */}
            <div className="flex items-center gap-3 p-5 bg-ice-50 rounded-2xl border border-ice-100">
                <Shield size={20} className="text-brand-primary shrink-0" />
                <p className="text-sm text-graphite-500 font-medium">
                    Todos os pagamentos são processados com segurança. Você pode cancelar ou alterar seu plano a qualquer momento sem multas.
                </p>
            </div>
        </div>
    );
};
