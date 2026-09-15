import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
    ShieldCheck, Zap, MessageCircle, ChevronRight, Globe,
    Users, Check, Calendar, FileText,
    CreditCard, TrendingUp, Smartphone, Building2,
    ArrowRight, Sparkles,
    Bell, PieChart, Lock, BadgeCheck, User,
} from 'lucide-react';
import { PLANS, PLAN_ORDER, formatPrice, AI_PACKAGES, type BillingCycle, type PlanId } from '../config/planConfig';
import { PlanComparisonTable } from '../components/landing/PlanComparisonTable';
import { PlanDetailsModal } from '../components/landing/PlanDetailsModal';

// Perfis da seção Soluções: por TAMANHO e rotina, nunca por especialidade —
// um card "Médico Autônomo" fazia nutricionista/psicólogo/dentista achar que o
// plano não servia para ele. Especialidades aparecem juntas, como universais.
const PROFILE_ICONS: Record<PlanId, typeof User> = { essencial: User, clinica: Users, rede: Building2 };
const SPECIALTY_KEYS = ['dentistry', 'medicine', 'nutrition', 'psychology', 'physio', 'speech', 'aesthetics', 'therapies'] as const;

// t(..., { returnObjects: true }) devolve a própria chave (string) enquanto o
// namespace não carregou ou se a chave faltar num idioma — .map direto nisso
// derrubava a landing inteira no ErrorBoundary.
const asList = (value: unknown): string[] => (Array.isArray(value) ? value : []);

export const LandingPage = () => {
    const { t } = useTranslation(['landing', 'billing']);
    const navigate = useNavigate();
    const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
    const [detailsPlan, setDetailsPlan] = useState<PlanId | null>(null);

    const startPlan = (id: PlanId) => {
        if (id === 'rede') {
            window.location.href = 'mailto:contato@traffio.com.br?subject=Plano Rede';
            return;
        }
        navigate(`/register?plan=${id}&cycle=${billingCycle}`);
    };


    return (
        <div className="min-h-screen bg-white">

            {/* ── Nav ─────────────────────────────────────────────── */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0D1B2A]/95 backdrop-blur-md border-b border-white/5 shadow-lg shadow-black/20">
                {/* Celular: sem menu hambúrguer, os links de seção sumiam e não dava
                    para chegar em Planos. Linha compacta só abaixo de md. */}
                <nav className="md:hidden flex items-center justify-center gap-6 py-2 text-xs font-bold text-slate-300 border-b border-white/5">
                    <a href="#features"  className="no-underline" style={{ color: 'inherit' }}>{t('nav.features')}</a>
                    <a href="#solutions" className="no-underline" style={{ color: 'inherit' }}>{t('nav.solutions')}</a>
                    <a href="#pricing"   className="no-underline" style={{ color: 'inherit' }}>{t('nav.pricing')}</a>
                    <button onClick={() => navigate('/login')} className="bg-transparent border-none p-0 text-xs font-bold cursor-pointer" style={{ color: 'inherit' }}>{t('nav.login')}</button>
                </nav>
                <div className="max-w-7xl mx-auto px-6 h-16 md:h-20 flex items-center justify-between">
                    {/* Marca em texto: o PNG do logo traz um dente dourado e "ODONTO •
                        MARKETING" gravados na imagem — nicha em odontologia, contra a
                        decisão de atender qualquer especialidade (15/09/2026). Até haver
                        um logo novo, a landing usa este wordmark neutro. */}
                    <a href="#" className="flex items-center gap-2.5 no-underline">
                        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-[#0D1B2A] flex items-center justify-center shadow-lg shadow-amber-500/30">
                            <Sparkles size={18} strokeWidth={2.5} />
                        </span>
                        <span className="text-xl font-black text-white tracking-tight">Traffio</span>
                    </a>
                    <nav className="hidden md:flex items-center gap-8 text-sm font-bold text-slate-300">
                        <a href="#features"  className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>{t('nav.features')}</a>
                        <a href="#solutions" className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>{t('nav.solutions')}</a>
                        <a href="#pricing"   className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>{t('nav.pricing')}</a>
                    </nav>
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/login')}
                            className="hidden md:block text-sm font-bold text-slate-300 hover:text-amber-400 transition-colors cursor-pointer border-none bg-transparent">
                            {t('nav.login')}
                        </button>
                        <button onClick={() => navigate('/register')}
                            className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-amber-500/40 hover:scale-105 transition-transform border-none cursor-pointer">
                            {t('nav.register')}
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Hero ─────────────────────────────────────────────── */}
            <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-black uppercase tracking-wider border border-amber-200">
                            <Zap size={14} className="fill-amber-500" />
                            {t('hero.badge')}
                        </div>
                        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-graphite-900 leading-[1.1] tracking-tight">
                            {/* Espaço explícito: sem ele, no celular (onde o <br> some) as duas
                                partes do título colavam ("prontuáriocom IA"). */}
                            {t('hero.titleLine1')}{' '}<br className="hidden md:block" />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-yellow-400">
                                {t('hero.titleHighlight')}
                            </span>
                        </h1>
                        <p className="text-lg text-graphite-500 font-medium max-w-xl leading-relaxed">
                            {t('hero.subtitle')}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button onClick={() => navigate('/register')}
                                className="px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-400 text-white rounded-2xl text-lg font-bold shadow-xl shadow-amber-500/30 hover:scale-105 active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer">
                                {t('hero.ctaPrimary')}
                                <ChevronRight size={20} />
                            </button>
                            <a href="#features"
                                className="px-8 py-4 bg-white text-graphite-900 border border-ice-200 rounded-2xl text-lg font-bold hover:bg-amber-50 hover:border-amber-200 transition-all cursor-pointer flex items-center justify-center no-underline" style={{ color: 'inherit' }}>
                                {t('hero.ctaSecondary')}
                            </a>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-graphite-400 pt-4">
                            <span className="flex items-center gap-1"><ShieldCheck size={16} className="text-emerald-500" /> {t('hero.trustData')}</span>
                            <span className="flex items-center gap-1"><Globe size={16} className="text-amber-500" /> {t('hero.trustCloud')}</span>
                            <span className="flex items-center gap-1"><BadgeCheck size={16} className="text-amber-500" /> {t('hero.trustTrial')}</span>
                        </div>
                    </div>
                    <div className="relative animate-in fade-in slide-in-from-right-8 duration-1000 delay-200">
                        <div className="absolute -inset-4 bg-gradient-to-tr from-brand-primary/20 to-brand-secondary/20 rounded-[40px] blur-3xl opacity-50" />
                        <img
                            src="https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80"
                            alt={t('hero.imageAlt')}
                            className="relative rounded-[32px] shadow-2xl border-4 border-white transform rotate-2 hover:rotate-0 transition-transform duration-500"
                        />
                        {/* Selos descritivos de recurso — nunca números de resultado: a
                            plataforma ainda não tem clientes, qualquer métrica seria inventada. */}
                        <div className="absolute -bottom-8 left-2 sm:-left-10 bg-white p-5 rounded-2xl shadow-xl border border-ice-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600"><Sparkles size={20} /></div>
                                <div>
                                    <p className="text-xs font-bold text-graphite-400 uppercase">{t('hero.floatingAiLabel')}</p>
                                    <p className="text-base font-black text-graphite-900">{t('hero.floatingAiValue')}</p>
                                </div>
                            </div>
                        </div>
                        <div className="absolute -top-6 right-2 sm:-right-6 bg-white p-4 rounded-2xl shadow-xl border border-ice-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center text-violet-600"><Bell size={20} /></div>
                                <div>
                                    <p className="text-xs font-bold text-graphite-400">{t('hero.floatingReminderLabel')}</p>
                                    <p className="text-sm font-black text-graphite-900">{t('hero.floatingReminderValue')}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Faixa de fatos do produto ─────────────────────────────
                Só características verificáveis da plataforma. Métricas de resultado
                (redução de faltas, faturamento) ficam fora até existirem clientes
                reais medidos. */}
            <section className="py-12 bg-[#0D1B2A]">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                        {(['ai', 'channels', 'languages', 'trial'] as const).map(key => ({
                            key,
                            value: t(`facts.${key}.value`),
                            label: t(`facts.${key}.label`),
                            sub: t(`facts.${key}.sub`),
                        })).map(s => (
                            <div key={s.key}>
                                <p className="text-4xl font-black text-amber-400 mb-1">{s.value}</p>
                                <p className="text-sm font-black text-white">{s.label}</p>
                                <p className="text-xs text-slate-400 font-medium mt-0.5">{s.sub}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                RECURSOS
            ══════════════════════════════════════════════════════════ */}
            <section id="features" className="py-28 bg-white">
                <div className="max-w-7xl mx-auto px-6 space-y-28">

                    {/* Heading */}
                    <div className="text-center max-w-2xl mx-auto">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-black uppercase tracking-wider mb-4 border border-amber-200">
                            <Zap size={14} className="fill-amber-500" />
                            {t('features.badge')}
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            {t('features.title')}
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            {t('features.subtitle')}
                        </p>
                    </div>

                    {/* Feature 1 — Agenda */}
                    <FeatureBlock
                        badge={t('features.agenda.badge')}
                        icon={Calendar}
                        iconBg="bg-brand-primary/10"
                        iconColor="text-brand-primary"
                        title={t('features.agenda.title')}
                        description={t('features.agenda.description')}
                        items={[
                            t('features.agenda.item1'),
                            t('features.agenda.item2'),
                            t('features.agenda.item3'),
                            t('features.agenda.item4'),
                            t('features.agenda.item5'),
                            t('features.agenda.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1506784983877-45594efa4cbe?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.agenda.imageAlt')}
                        reverse={false}
                    />

                    {/* Feature 2 — Atendimento com IA */}
                    <FeatureBlock
                        badge={t('features.ai.badge')}
                        icon={Sparkles}
                        iconBg="bg-amber-50"
                        iconColor="text-amber-600"
                        title={t('features.ai.title')}
                        description={t('features.ai.description')}
                        items={[
                            t('features.ai.item1'),
                            t('features.ai.item2'),
                            t('features.ai.item3'),
                            t('features.ai.item4'),
                            t('features.ai.item5'),
                            t('features.ai.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1512428559087-560fa5ceab42?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.ai.imageAlt')}
                        reverse={true}
                    />

                    {/* Feature 3 — Caixa de entrada e comunicação */}
                    <FeatureBlock
                        badge={t('features.whatsapp.badge')}
                        icon={MessageCircle}
                        iconBg="bg-emerald-100"
                        iconColor="text-emerald-600"
                        title={t('features.whatsapp.title')}
                        description={t('features.whatsapp.description')}
                        items={[
                            t('features.whatsapp.item1'),
                            t('features.whatsapp.item2'),
                            t('features.whatsapp.item3'),
                            t('features.whatsapp.item4'),
                            t('features.whatsapp.item5'),
                            t('features.whatsapp.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1611746872915-64382b5c76da?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.whatsapp.imageAlt')}
                        reverse={false}
                    />

                    {/* Feature 4 — Prontuário */}
                    <FeatureBlock
                        badge={t('features.prontuario.badge')}
                        icon={FileText}
                        iconBg="bg-indigo-50"
                        iconColor="text-indigo-500"
                        title={t('features.prontuario.title')}
                        description={t('features.prontuario.description')}
                        items={[
                            t('features.prontuario.item1'),
                            t('features.prontuario.item2'),
                            t('features.prontuario.item3'),
                            t('features.prontuario.item4'),
                            t('features.prontuario.item5'),
                            t('features.prontuario.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1666214280557-f1b5022eb634?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.prontuario.imageAlt')}
                        reverse={true}
                    />

                    {/* Feature 5 — Financeiro */}
                    <FeatureBlock
                        badge={t('features.financeiro.badge')}
                        icon={CreditCard}
                        iconBg="bg-amber-50"
                        iconColor="text-amber-500"
                        title={t('features.financeiro.title')}
                        description={t('features.financeiro.description')}
                        items={[
                            t('features.financeiro.item1'),
                            t('features.financeiro.item2'),
                            t('features.financeiro.item3'),
                            t('features.financeiro.item4'),
                            t('features.financeiro.item5'),
                            t('features.financeiro.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1563013544-824ae1b704d3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.financeiro.imageAlt')}
                        reverse={false}
                    />

                    {/* Feature 6 — CRM + Marketing */}
                    <FeatureBlock
                        badge={t('features.crm.badge')}
                        icon={TrendingUp}
                        iconBg="bg-rose-50"
                        iconColor="text-rose-500"
                        title={t('features.crm.title')}
                        description={t('features.crm.description')}
                        items={[
                            t('features.crm.item1'),
                            t('features.crm.item2'),
                            t('features.crm.item3'),
                            t('features.crm.item4'),
                            t('features.crm.item5'),
                            t('features.crm.item6'),
                        ]}
                        image="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt={t('features.crm.imageAlt')}
                        reverse={true}
                    />

                    {/* Cards de recursos adicionais */}
                    <div>
                        <h3 className="text-2xl font-black text-graphite-900 text-center mb-10">{t('features.more.title')}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {[
                                { icon: Smartphone,    bg: 'bg-violet-50',    color: 'text-violet-500',   title: t('features.more.portal.title'),  desc: t('features.more.portal.desc') },
                                { icon: MessageCircle, bg: 'bg-sky-50',       color: 'text-sky-500',      title: t('features.more.sms.title'),     desc: t('features.more.sms.desc') },
                                { icon: PieChart,      bg: 'bg-emerald-50',   color: 'text-emerald-600',  title: t('features.more.reports.title'), desc: t('features.more.reports.desc') },
                                { icon: Lock,          bg: 'bg-graphite-100', color: 'text-graphite-700', title: t('features.more.security.title'), desc: t('features.more.security.desc') },
                            ].map(c => (
                                <div key={c.title} className="bg-white border border-ice-100 rounded-[24px] p-7 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                                    <div className={`w-12 h-12 ${c.bg} ${c.color} rounded-xl flex items-center justify-center mb-4`}>
                                        <c.icon size={22} />
                                    </div>
                                    <h4 className="text-base font-black text-graphite-900 mb-2">{c.title}</h4>
                                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">{c.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                SOLUÇÕES
            ══════════════════════════════════════════════════════════ */}
            <section id="solutions" className="py-28 bg-ice-50/60">
                <div className="max-w-7xl mx-auto px-6">

                    {/* Heading */}
                    <div className="text-center max-w-2xl mx-auto mb-16">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-black uppercase tracking-wider mb-4 border border-amber-200">
                            <Zap size={14} className="fill-amber-500" />
                            {t('solutions.badge')}
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            {t('solutions.title')}
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            {t('solutions.subtitle')}
                        </p>
                    </div>

                    {/* Especialidades — todas atendidas pela mesma plataforma */}
                    <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                        <span className="text-sm font-black text-graphite-500 mr-1">{t('guide.worksFor')}</span>
                        {SPECIALTY_KEYS.map(key => (
                            <span key={key} className="px-3 py-1.5 bg-white border border-ice-100 rounded-full text-xs font-bold text-graphite-700">
                                {t(`guide.specialties.${key}`)}
                            </span>
                        ))}
                    </div>
                    <p className="text-center text-sm text-graphite-500 font-medium mb-14 max-w-2xl mx-auto leading-relaxed">{t('guide.modulesNote')}</p>

                    {/* Perfis por tamanho de consultório/clínica → abrem o detalhe do plano */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
                        {PLAN_ORDER.map(id => {
                            const plan = PLANS[id];
                            const ProfileIcon = PROFILE_ICONS[id];
                            const isPopular = id === 'clinica';
                            return (
                                <button key={id} type="button" onClick={() => setDetailsPlan(id)}
                                    className={`group text-left bg-white rounded-3xl p-8 flex flex-col transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-xl border-2 ${isPopular ? 'border-amber-300 shadow-lg shadow-amber-400/10' : 'border-ice-100 hover:border-amber-200'}`}>
                                    <div className="flex items-center justify-between mb-5">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${plan.badgeClass}`}>
                                            <ProfileIcon size={26} />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-graphite-500 bg-ice-100 px-3 py-1 rounded-full">
                                            {t('guide.planLabel', { plan: t(`plans.${id}.name`, { ns: 'billing' }) })}
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-black text-graphite-900 mb-2">{t(`guide.profiles.${id}.title`)}</h3>
                                    <p className="text-sm text-graphite-500 font-medium leading-relaxed mb-5">{t(`guide.profiles.${id}.desc`)}</p>
                                    <ul className="space-y-2.5 mb-6 flex-1">
                                        {asList(t(`guide.profiles.${id}.bullets`, { returnObjects: true })).map(b => (
                                            <li key={b} className="flex items-start gap-2 text-sm text-graphite-700 font-medium">
                                                <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" /> {b}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="flex items-start gap-2 bg-amber-50 rounded-2xl px-4 py-3 mb-6">
                                        <Sparkles size={15} className="text-amber-500 shrink-0 mt-0.5" />
                                        <span className="text-xs font-bold text-amber-800 leading-relaxed">
                                            {plan.aiConversationsIncluded > 0
                                                ? t('guide.aiIncluded', { count: plan.aiConversationsIncluded })
                                                : t('guide.aiPack', { price: formatPrice(AI_PACKAGES[0].priceBrl) })}
                                        </span>
                                    </div>
                                    <div className="border-t border-ice-100 pt-5 flex items-center justify-between gap-3">
                                        <p className="text-sm font-black text-graphite-900">
                                            {formatPrice(plan.monthlyPrice)}<span className="text-graphite-400 font-medium">{t('pricing.perMonth')}</span>
                                        </p>
                                        <span className="text-sm font-black text-amber-700 flex items-center gap-1 group-hover:gap-2 transition-all">
                                            {t('guide.seeDetails')} <ArrowRight size={14} />
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                </div>
            </section>

            {/* ══════════════════════════════════════════════════════════
                PRICING
            ══════════════════════════════════════════════════════════ */}
            <section id="pricing" className="py-24 bg-white">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center max-w-2xl mx-auto mb-12">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-black uppercase tracking-wider mb-4 border border-amber-200">
                            <Zap size={14} className="fill-amber-500" />
                            {t('pricing.badge')}
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            {t('pricing.title')}
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            {t('pricing.subtitle')}
                        </p>
                    </div>

                    {/* Toggle */}
                    <div className="flex justify-center mb-12">
                        <div className="inline-flex items-center bg-ice-100 rounded-2xl p-1 gap-1">
                            <button onClick={() => setBillingCycle('monthly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all border-none cursor-pointer ${billingCycle === 'monthly' ? 'bg-white text-graphite-900 shadow-sm' : 'text-graphite-500 hover:text-graphite-700 bg-transparent'}`}>
                                {t('pricing.toggleMonthly')}
                            </button>
                            <button onClick={() => setBillingCycle('annual')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 border-none cursor-pointer ${billingCycle === 'annual' ? 'bg-white text-graphite-900 shadow-sm' : 'text-graphite-500 hover:text-graphite-700 bg-transparent'}`}>
                                {t('pricing.toggleAnnual')}
                                <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full">{t('billingPage.cycleToggle.discountBadge', { ns: 'billing' })}</span>
                            </button>
                        </div>
                    </div>

                    {/* Plan cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
                        {PLAN_ORDER.map((id: PlanId) => {
                            const plan = PLANS[id];
                            const Icon = plan.icon;
                            const price = billingCycle === 'annual' ? plan.annualMonthlyPrice : plan.monthlyPrice;
                            const isPopular = id === 'clinica';
                            return (
                                <div key={id}
                                    className={`relative bg-white rounded-[32px] p-8 border-2 flex flex-col transition-all ${isPopular ? 'border-amber-400 shadow-2xl shadow-amber-400/15 scale-[1.02]' : 'border-ice-100 hover:border-amber-200 hover:shadow-lg'}`}>
                                    {isPopular && (
                                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-yellow-400 text-white text-[10px] font-black px-5 py-1.5 rounded-full uppercase tracking-widest whitespace-nowrap shadow-lg shadow-amber-500/30">
                                            {t('pricing.mostPopular')}
                                        </div>
                                    )}
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${plan.badgeClass}`}>
                                        <Icon size={24} />
                                    </div>
                                    <h3 className="text-2xl font-black text-graphite-900 mb-1">{t(`plans.${id}.name`, { ns: 'billing' })}</h3>
                                    <p className="text-sm text-graphite-400 font-medium mb-6 leading-relaxed">{t(`plans.${id}.description`, { ns: 'billing' })}</p>
                                    <div className="mb-2">
                                        <span className="text-4xl font-black text-graphite-900">{formatPrice(price)}</span>
                                        <span className="text-graphite-400 text-sm font-medium">{t('pricing.perMonth')}</span>
                                    </div>
                                    {billingCycle === 'annual'
                                        ? <p className="text-xs text-emerald-600 font-black mb-6">{t('pricing.billedAnnually', { total: formatPrice(price * 12), savings: formatPrice((plan.monthlyPrice - price) * 12) })}</p>
                                        : <div className="mb-6" />}
                                    <ul className="space-y-3 flex-1 mb-8">
                                        {asList(t(`plans.${id}.features`, { ns: 'billing', returnObjects: true })).map(f => (
                                            <li key={f} className="flex items-start gap-2.5">
                                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${plan.badgeClass}`}>
                                                    <Check size={11} />
                                                </div>
                                                <span className="text-sm text-graphite-600 font-medium">{f}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <button onClick={() => startPlan(id)}
                                        className={`w-full py-4 rounded-2xl font-black text-sm transition-all border-none cursor-pointer ${isPopular ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-lg shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98]' : id === 'rede' ? 'bg-[#0D1B2A] text-white hover:scale-[1.02] active:scale-[0.98]' : 'bg-ice-100 text-graphite-700 hover:bg-amber-50 hover:text-amber-700'}`}>
                                        {id === 'rede' ? t('pricing.talkToSales') : t('pricing.startTrial14')}
                                    </button>
                                    <button onClick={() => setDetailsPlan(id)}
                                        className="w-full mt-3 py-2.5 rounded-xl text-sm font-black text-graphite-600 hover:text-amber-700 bg-transparent border border-ice-200 hover:border-amber-200 cursor-pointer transition-colors">
                                        {t('guide.seeEverything')}
                                    </button>
                                    <p className="text-center text-xs text-graphite-400 font-medium mt-3">
                                        {id === 'rede' ? t('pricing.assistedOnboarding') : t('pricing.freeTrialCancelAnytime')}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    {/* Tabela comparativa completa */}
                    <div className="text-center max-w-2xl mx-auto mb-8">
                        <h3 className="text-3xl font-black text-graphite-900 tracking-tight mb-3">{t('compare.title')}</h3>
                        <p className="text-graphite-500 font-medium">{t('compare.subtitle')}</p>
                    </div>
                    <PlanComparisonTable />

                    <div className="text-center mt-12">
                        <p className="text-graphite-500 font-medium mb-4">
                            {t('pricing.questionsPrefix')} <a href="mailto:contato@traffio.com.br" className="text-brand-primary font-bold underline">{t('pricing.talkToTeam')}</a>
                        </p>
                        <p className="text-xs text-graphite-400 font-medium">
                            <ShieldCheck size={12} className="inline mr-1 text-emerald-500" />
                            {t('pricing.allPlansTrial')}
                        </p>
                    </div>
                </div>
            </section>

            {detailsPlan && (
                <PlanDetailsModal
                    planId={detailsPlan}
                    billingCycle={billingCycle}
                    onChangePlan={setDetailsPlan}
                    onClose={() => setDetailsPlan(null)}
                    onStart={startPlan}
                />
            )}

            {/* ── Footer ─────────────────────────────────────────────── */}
            <footer className="bg-[#0D1B2A] py-16 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
                        <div className="md:col-span-2 space-y-4">
                            <div className="flex items-center gap-3">
                                <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-[#0D1B2A] flex items-center justify-center">
                                    <Sparkles size={20} strokeWidth={2.5} />
                                </span>
                                <div>
                                    <p className="text-xl font-black text-white leading-none">Traffio</p>
                                    <p className="text-xs text-amber-400 font-bold tracking-wider">{t('footer.tagline')}</p>
                                </div>
                            </div>
                            <p className="text-slate-400 font-medium text-sm leading-relaxed max-w-xs">
                                {t('footer.description')}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium pt-2">
                                <ShieldCheck size={14} className="text-emerald-400" /> {t('footer.dataIsolation')}
                                <Globe size={14} className="text-amber-400" /> {t('footer.cloud100')}
                            </div>
                        </div>
                        {/* Só links que levam a algum lugar real: seções da página, contato e páginas legais */}
                        <div className="space-y-4">
                            <h4 className="text-white font-black text-sm uppercase tracking-wider">{t('footer.platformHeading')}</h4>
                            <ul className="space-y-2">
                                {[
                                    { key: 'features', label: t('footer.linkFeatures') },
                                    { key: 'solutions', label: t('footer.linkSolutions') },
                                    { key: 'pricing', label: t('footer.linkPricing') },
                                ].map(l => (
                                    <li key={l.key}><a href={`#${l.key}`} className="text-graphite-400 text-sm font-medium hover:text-white transition-colors no-underline" style={{ color: 'inherit' }}>{l.label}</a></li>
                                ))}
                            </ul>
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-white font-black text-sm uppercase tracking-wider">{t('footer.companyHeading')}</h4>
                            <ul className="space-y-2">
                                <li><a href="mailto:contato@traffio.com.br" className="text-graphite-400 text-sm font-medium hover:text-white transition-colors no-underline" style={{ color: 'inherit' }}>{t('footer.linkContact')}</a></li>
                                <li><button onClick={() => navigate('/privacidade')} className="text-graphite-400 text-sm font-medium hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer">{t('footer.privacy')}</button></li>
                                <li><button onClick={() => navigate('/termos')} className="text-graphite-400 text-sm font-medium hover:text-white transition-colors bg-transparent border-none p-0 cursor-pointer">{t('footer.terms')}</button></li>
                            </ul>
                        </div>
                    </div>
                    <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-slate-500 text-sm font-medium">{t('footer.copyright')}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

// ── Componente de bloco de feature (alternado) ─────────────────────────────

interface FeatureBlockProps {
    badge: string; icon: any; iconBg: string; iconColor: string;
    title: string; description: string; items: string[];
    image: string; imageAlt: string; reverse: boolean;
}

function FeatureBlock({ badge, icon: Icon, iconBg, iconColor, title, description, items, image, imageAlt, reverse }: FeatureBlockProps) {
    return (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${reverse ? 'lg:[direction:rtl]' : ''}`}>
            <div className={`space-y-6 ${reverse ? '[direction:ltr]' : ''}`}>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider ${iconBg} ${iconColor}`}>
                    <Icon size={13} />
                    {badge}
                </div>
                <h3 className="text-3xl font-black text-graphite-900 leading-tight">{title}</h3>
                <p className="text-graphite-500 font-medium leading-relaxed">{description}</p>
                <ul className="space-y-3">
                    {items.map(item => (
                        <li key={item} className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
                                <Check size={11} />
                            </div>
                            <span className="text-sm font-medium text-graphite-700">{item}</span>
                        </li>
                    ))}
                </ul>
            </div>
            <div className={`relative ${reverse ? '[direction:ltr]' : ''}`}>
                <div className={`absolute -inset-4 rounded-[40px] blur-3xl opacity-30 ${iconBg}`} />
                <img src={image} alt={imageAlt}
                    className="relative rounded-[28px] shadow-2xl border-2 border-white object-cover w-full h-72 lg:h-96" />
            </div>
        </div>
    );
}

