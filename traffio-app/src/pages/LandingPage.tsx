import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity, ShieldCheck, Zap, MessageCircle, ChevronRight, Globe,
    BarChart3, Users, Check, X, Minus, Calendar, FileText,
    CreditCard, TrendingUp, Smartphone, Building2, Stethoscope,
    Brain, Leaf, Smile, Dumbbell, ArrowRight, Star, Clock,
    Bell, Inbox, ScanLine, PieChart, Lock, BadgeCheck,
} from 'lucide-react';
import { PLANS, PLAN_ORDER, formatPrice, type BillingCycle, type PlanId } from '../config/planConfig';

export const LandingPage = () => {
    const navigate = useNavigate();
    const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

    return (
        <div className="min-h-screen bg-white">

            {/* ── Nav ─────────────────────────────────────────────── */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0D1B2A]/95 backdrop-blur-md border-b border-white/5 shadow-lg shadow-black/20">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <a href="#" className="flex items-center">
                        <img src="/logo_dark.png" alt="Traffio Odonto Marketing" className="h-16 w-auto object-contain" />
                    </a>
                    <nav className="hidden md:flex items-center gap-8 text-sm font-bold text-slate-300">
                        <a href="#features"  className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>Recursos</a>
                        <a href="#solutions" className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>Soluções</a>
                        <a href="#pricing"   className="hover:text-amber-400 transition-colors cursor-pointer no-underline" style={{ color: 'inherit' }}>Planos</a>
                    </nav>
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/login')}
                            className="hidden md:block text-sm font-bold text-slate-300 hover:text-amber-400 transition-colors cursor-pointer border-none bg-transparent">
                            Entrar
                        </button>
                        <button onClick={() => navigate('/register')}
                            className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-amber-500/40 hover:scale-105 transition-transform border-none cursor-pointer">
                            Começar Agora
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
                            A Nova Era do Odonto Marketing
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black text-graphite-900 leading-[1.1] tracking-tight">
                            Odonto Marketing<br className="hidden md:block" />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-yellow-400">
                                que converte
                            </span>
                        </h1>
                        <p className="text-lg text-graphite-500 font-medium max-w-xl leading-relaxed">
                            A plataforma completa para clínicas odontológicas. Agenda inteligente, prontuário digital, WhatsApp, CRM com Meta Ads e hub financeiro — tudo integrado.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button onClick={() => navigate('/register')}
                                className="px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-400 text-white rounded-2xl text-lg font-bold shadow-xl shadow-amber-500/30 hover:scale-105 active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer">
                                Criar Conta Grátis
                                <ChevronRight size={20} />
                            </button>
                            <a href="#features"
                                className="px-8 py-4 bg-white text-graphite-900 border border-ice-200 rounded-2xl text-lg font-bold hover:bg-amber-50 hover:border-amber-200 transition-all cursor-pointer flex items-center justify-center no-underline" style={{ color: 'inherit' }}>
                                Ver Recursos
                            </a>
                        </div>
                        <div className="flex items-center gap-4 text-sm font-medium text-graphite-400 pt-4">
                            <span className="flex items-center gap-1"><ShieldCheck size={16} className="text-emerald-500" /> LGPD Compliant</span>
                            <span className="flex items-center gap-1"><Globe size={16} className="text-amber-500" /> 100% Nuvem</span>
                            <span className="flex items-center gap-1"><BadgeCheck size={16} className="text-amber-500" /> 14 dias grátis</span>
                        </div>
                    </div>
                    <div className="relative animate-in fade-in slide-in-from-right-8 duration-1000 delay-200">
                        <div className="absolute -inset-4 bg-gradient-to-tr from-brand-primary/20 to-brand-secondary/20 rounded-[40px] blur-3xl opacity-50" />
                        <img
                            src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80"
                            alt="Plataforma Traffio"
                            className="relative rounded-[32px] shadow-2xl border-4 border-white transform rotate-2 hover:rotate-0 transition-transform duration-500"
                        />
                        <div className="absolute -bottom-10 -left-10 bg-white p-5 rounded-2xl shadow-xl border border-ice-100 animate-bounce delay-700 duration-[3000ms]">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600"><BarChart3 size={20} /></div>
                                <div>
                                    <p className="text-xs font-bold text-graphite-400 uppercase">Faturamento</p>
                                    <p className="text-xl font-black text-graphite-900">+127%</p>
                                </div>
                            </div>
                        </div>
                        <div className="absolute -top-6 -right-6 bg-white p-4 rounded-2xl shadow-xl border border-ice-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center text-violet-600"><Bell size={20} /></div>
                                <div>
                                    <p className="text-xs font-bold text-graphite-400">No-show evitado</p>
                                    <p className="text-sm font-black text-graphite-900">-62%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Stats Bar ─────────────────────────────────────────── */}
            <section className="py-12 bg-[#0D1B2A]">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                        {[
                            { value: '-62%', label: 'Redução de no-shows', sub: 'com lembretes automáticos' },
                            { value: '+127%', label: 'Aumento de faturamento', sub: 'média entre clientes' },
                            { value: '3×', label: 'Mais conversões', sub: 'via CRM + WhatsApp' },
                            { value: '14 dias', label: 'Trial gratuito', sub: 'cancele quando quiser' },
                        ].map(s => (
                            <div key={s.value}>
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
                            Recursos
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            Tudo que sua clínica precisa
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            Uma plataforma completa, sem necessidade de contratar sistemas separados para cada função.
                        </p>
                    </div>

                    {/* Feature 1 — Agenda */}
                    <FeatureBlock
                        badge="Agenda"
                        icon={Calendar}
                        iconBg="bg-brand-primary/10"
                        iconColor="text-brand-primary"
                        title="Agenda inteligente que trabalha por você"
                        description="Visualize todos os profissionais em uma única tela, mova agendamentos com drag-and-drop e deixe pacientes marcarem consultas online 24h por dia — sem precisar ligar."
                        items={[
                            'Agenda visual com drag-and-drop',
                            'Agendamento online pelo portal do paciente',
                            'Múltiplos profissionais e unidades na mesma tela',
                            'Check-in digital e sala de espera virtual',
                            'Lista de espera automática',
                            'Anti-duplo-agendamento inteligente',
                        ]}
                        image="https://images.unsplash.com/photo-1506784983877-45594efa4cbe?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt="Agenda da clínica"
                        reverse={false}
                    />

                    {/* Feature 2 — WhatsApp */}
                    <FeatureBlock
                        badge="WhatsApp"
                        icon={MessageCircle}
                        iconBg="bg-emerald-100"
                        iconColor="text-emerald-600"
                        title="Comunicação centralizada no WhatsApp"
                        description="Conecte o número do consultório à plataforma e gerencie todas as conversas com pacientes em um inbox centralizado. Lembretes automáticos reduzem faltas sem esforço da equipe."
                        items={[
                            'Lembretes automáticos 48h, 24h e 2h antes da consulta',
                            'Confirmação e pesquisa de satisfação (NPS) automáticos',
                            'Inbox humano com kanban de atendimentos',
                            'Envio de imagens, vídeos e documentos',
                            'Quick replies e tags para organizar conversas',
                            'SLA de tempo de resposta visível para a equipe',
                        ]}
                        image="https://images.unsplash.com/photo-1611746872915-64382b5c76da?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt="WhatsApp da clínica"
                        reverse={true}
                    />

                    {/* Feature 3 — Prontuário */}
                    <FeatureBlock
                        badge="Prontuário"
                        icon={FileText}
                        iconBg="bg-indigo-50"
                        iconColor="text-indigo-500"
                        title="Prontuário eletrônico completo e multi-especialidade"
                        description="Registre evoluções, receitas e exames em uma timeline clínica visual. Suporte a múltiplas especialidades — odontologia, nutrição, medicina geral — tudo em um só lugar."
                        items={[
                            'Timeline clínica com histórico completo',
                            'Evoluções, receitas e prescrições digitais',
                            'Upload e visualização de exames e documentos',
                            'Odontograma digital com procedimentos por face',
                            'Visualizador DICOM para radiografias',
                            'Avaliação antropométrica para nutrição',
                        ]}
                        image="https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt="Prontuário eletrônico"
                        reverse={false}
                    />

                    {/* Feature 4 — Financeiro */}
                    <FeatureBlock
                        badge="Financeiro"
                        icon={CreditCard}
                        iconBg="bg-amber-50"
                        iconColor="text-amber-500"
                        title="Hub de pagamentos com 3 gateways integrados"
                        description="Receba via PIX, boleto, cartão de crédito ou financiamento — tudo dentro da plataforma. Webhooks automáticos atualizam o status do agendamento ao confirmar o pagamento."
                        items={[
                            'Asaas: PIX instantâneo, boleto e cartão',
                            'Pagar.me: cartão de crédito parcelado',
                            'Dr. Cash: financiamento sem cartão em até 24x',
                            'Checkout modal integrado no atendimento',
                            'Confirmação automática do agendamento ao pagar',
                            'Dashboard financeiro com KPIs em tempo real',
                        ]}
                        image="https://images.unsplash.com/photo-1563013544-824ae1b704d3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt="Hub financeiro"
                        reverse={true}
                    />

                    {/* Feature 5 — CRM + Marketing */}
                    <FeatureBlock
                        badge="CRM & Marketing"
                        icon={TrendingUp}
                        iconBg="bg-rose-50"
                        iconColor="text-rose-500"
                        title="CRM + integração com Meta e Google Ads"
                        description="Gerencie o pipeline de leads com kanban de follow-up e veja em tempo real de onde vieram seus pacientes — Facebook, Instagram ou Google. Tome decisões de marketing com dados reais."
                        items={[
                            'Kanban de follow-up com estágios configuráveis',
                            'Estimativa de receita por conversa',
                            'Integração Meta Ads (Facebook + Instagram)',
                            'Integração Google Ads',
                            'Dashboard ROAS, CPL e taxa de conversão',
                            'Captura automática de leads por formulário de anúncio',
                        ]}
                        image="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
                        imageAlt="CRM e marketing"
                        reverse={false}
                    />

                    {/* Cards de recursos adicionais */}
                    <div>
                        <h3 className="text-2xl font-black text-graphite-900 text-center mb-10">E muito mais</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {[
                                { icon: Smartphone, bg: 'bg-violet-50', color: 'text-violet-500', title: 'Portal do Paciente', desc: 'Agendamento online, histórico e perfil — tudo acessível pelo celular.' },
                                { icon: ScanLine,   bg: 'bg-sky-50',    color: 'text-sky-500',    title: 'DICOM & Imagens', desc: 'Visualizador de radiografias e exames de imagem diretamente no prontuário.' },
                                { icon: PieChart,   bg: 'bg-emerald-50',color: 'text-emerald-600', title: 'Relatórios', desc: 'Análises de ocupação, receita e desempenho com exportação.' },
                                { icon: Lock,       bg: 'bg-graphite-100', color: 'text-graphite-700', title: 'LGPD & Segurança', desc: 'Dados criptografados, RLS por tenant e conformidade total com a LGPD.' },
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
                            Soluções
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            Feito para a sua especialidade
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            A mesma plataforma, configurada para cada tipo de clínica. Sem módulos extras, sem custo adicional.
                        </p>
                    </div>

                    {/* Solution cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
                        {SOLUTIONS.map(sol => (
                            <SolutionCard key={sol.title} sol={sol} onStart={() => navigate('/register')} />
                        ))}
                    </div>

                    {/* Testemunho / social proof */}
                    <div className="bg-white rounded-[32px] p-10 border border-ice-100 shadow-sm">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-center">
                            <div className="lg:col-span-2 space-y-4">
                                <div className="flex gap-1">
                                    {[...Array(5)].map((_, i) => (
                                        <Star key={i} size={18} className="text-amber-400 fill-amber-400" />
                                    ))}
                                </div>
                                <blockquote className="text-xl font-bold text-graphite-800 leading-relaxed">
                                    "Antes usávamos três sistemas diferentes. Com o Traffio, a equipe agenda, atende pelo WhatsApp e fecha o pagamento na mesma tela. Reduzimos faltas em mais de 60% no primeiro mês."
                                </blockquote>
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-brand-primary/10 rounded-full flex items-center justify-center text-brand-primary font-black text-lg">D</div>
                                    <div>
                                        <p className="font-black text-graphite-900">Dra. Camila Souza</p>
                                        <p className="text-sm text-graphite-500 font-medium">Clínica Odontológica · São Paulo</p>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { label: 'Redução de faltas', value: '-61%' },
                                    { label: 'Conversão de leads', value: '+3×' },
                                    { label: 'Tempo na agenda', value: '-4h/sem' },
                                    { label: 'Faturamento', value: '+R$ 8k/mês' },
                                ].map(m => (
                                    <div key={m.label} className="bg-ice-50 rounded-2xl p-4 text-center">
                                        <p className="text-2xl font-black text-brand-primary">{m.value}</p>
                                        <p className="text-xs font-bold text-graphite-500 mt-1">{m.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
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
                            Planos e Preços
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-graphite-900 tracking-tight mb-4">
                            Simples, sem surpresas
                        </h2>
                        <p className="text-graphite-500 text-lg font-medium">
                            Preço fixo por clínica. Sem cobranças por profissional. Cancele quando quiser.
                        </p>
                    </div>

                    {/* Toggle */}
                    <div className="flex justify-center mb-12">
                        <div className="inline-flex items-center bg-ice-100 rounded-2xl p-1 gap-1">
                            <button onClick={() => setBillingCycle('monthly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all border-none cursor-pointer ${billingCycle === 'monthly' ? 'bg-white text-graphite-900 shadow-sm' : 'text-graphite-500 hover:text-graphite-700 bg-transparent'}`}>
                                Mensal
                            </button>
                            <button onClick={() => setBillingCycle('annual')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 border-none cursor-pointer ${billingCycle === 'annual' ? 'bg-white text-graphite-900 shadow-sm' : 'text-graphite-500 hover:text-graphite-700 bg-transparent'}`}>
                                Anual
                                <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full">-20%</span>
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
                                            Mais Popular
                                        </div>
                                    )}
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${plan.badgeClass}`}>
                                        <Icon size={24} />
                                    </div>
                                    <h3 className="text-2xl font-black text-graphite-900 mb-1">{plan.name}</h3>
                                    <p className="text-sm text-graphite-400 font-medium mb-6 leading-relaxed">{plan.description}</p>
                                    <div className="mb-2">
                                        <span className="text-4xl font-black text-graphite-900">{formatPrice(price)}</span>
                                        <span className="text-graphite-400 text-sm font-medium">/mês</span>
                                    </div>
                                    {billingCycle === 'annual'
                                        ? <p className="text-xs text-emerald-600 font-black mb-6">cobrado {formatPrice(price * 12)}/ano · economize {formatPrice((plan.monthlyPrice - price) * 12)}</p>
                                        : <div className="mb-6" />}
                                    <ul className="space-y-3 flex-1 mb-8">
                                        {plan.highlightFeatures.map(f => (
                                            <li key={f} className="flex items-start gap-2.5">
                                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${plan.badgeClass}`}>
                                                    <Check size={11} />
                                                </div>
                                                <span className="text-sm text-graphite-600 font-medium">{f}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <button onClick={() => navigate(`/register?plan=${id}&cycle=${billingCycle}`)}
                                        className={`w-full py-4 rounded-2xl font-black text-sm transition-all border-none cursor-pointer ${isPopular ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-lg shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98]' : id === 'rede' ? 'bg-[#0D1B2A] text-white hover:scale-[1.02] active:scale-[0.98]' : 'bg-ice-100 text-graphite-700 hover:bg-amber-50 hover:text-amber-700'}`}>
                                        {id === 'rede' ? 'Falar com vendas' : 'Começar trial de 14 dias'}
                                    </button>
                                    <p className="text-center text-xs text-graphite-400 font-medium mt-3">
                                        {id === 'rede' ? 'Implantação assistida inclusa' : '14 dias grátis · cancele quando quiser'}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    {/* Comparison table */}
                    <div className="overflow-x-auto rounded-[32px] border border-ice-100 shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-ice-100">
                                    <th className="text-left p-6 font-black text-graphite-900 w-2/5 bg-ice-50/50">Recurso</th>
                                    {PLAN_ORDER.map(id => {
                                        const plan = PLANS[id];
                                        const Icon = plan.icon;
                                        return (
                                            <th key={id} className={`p-6 text-center font-black ${id === 'clinica' ? 'bg-brand-primary/5 text-brand-primary' : 'text-graphite-700 bg-ice-50/50'}`}>
                                                <div className="flex flex-col items-center gap-1"><Icon size={18} />{plan.name}</div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_ROWS.map((row, i) => (
                                    row.type === 'header'
                                        ? <tr key={i} className="bg-ice-50/80"><td colSpan={4} className="px-6 py-3 font-black text-xs text-graphite-400 uppercase tracking-widest">{row.label}</td></tr>
                                        : (
                                            <tr key={i} className="border-t border-ice-100 hover:bg-ice-50/50 transition-colors">
                                                <td className="px-6 py-4 font-medium text-graphite-700">{row.label}</td>
                                                {PLAN_ORDER.map(id => (
                                                    <td key={id} className={`px-6 py-4 text-center ${id === 'clinica' ? 'bg-brand-primary/[0.02]' : ''}`}>
                                                        <CellValue value={row.values[id]} />
                                                    </td>
                                                ))}
                                            </tr>
                                        )
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="text-center mt-12">
                        <p className="text-graphite-500 font-medium mb-4">
                            Dúvidas? <a href="mailto:contato@traffio.com.br" className="text-brand-primary font-bold underline">Fale com nosso time</a>
                        </p>
                        <p className="text-xs text-graphite-400 font-medium">
                            <ShieldCheck size={12} className="inline mr-1 text-emerald-500" />
                            Todos os planos incluem 14 dias de trial grátis · Sem fidelidade · Cancele quando quiser
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Footer ─────────────────────────────────────────────── */}
            <footer className="bg-[#0D1B2A] py-16 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
                        <div className="md:col-span-2 space-y-4">
                            <div className="flex items-center gap-3">
                                <img src="/favicon.png" alt="Traffio" className="h-12 w-12 rounded-xl" />
                                <div>
                                    <p className="text-xl font-black text-white leading-none">Traffio</p>
                                    <p className="text-xs text-amber-400 font-bold tracking-wider">ODONTO • MARKETING</p>
                                </div>
                            </div>
                            <p className="text-slate-400 font-medium text-sm leading-relaxed max-w-xs">
                                A plataforma completa para clínicas odontológicas que buscam crescimento e eficiência máxima.
                            </p>
                            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium pt-2">
                                <ShieldCheck size={14} className="text-emerald-400" /> LGPD Compliant
                                <Globe size={14} className="text-amber-400" /> 100% Nuvem
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-white font-black text-sm uppercase tracking-wider">Plataforma</h4>
                            <ul className="space-y-2">
                                {['Recursos', 'Soluções', 'Planos', 'Segurança'].map(l => (
                                    <li key={l}><a href={`#${l.toLowerCase()}`} className="text-graphite-400 text-sm font-medium hover:text-white transition-colors no-underline" style={{ color: 'inherit' }}>{l}</a></li>
                                ))}
                            </ul>
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-white font-black text-sm uppercase tracking-wider">Empresa</h4>
                            <ul className="space-y-2">
                                {['Sobre', 'Blog', 'Contato', 'Suporte'].map(l => (
                                    <li key={l}><span className="text-graphite-400 text-sm font-medium hover:text-white transition-colors cursor-pointer">{l}</span></li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-slate-500 text-sm font-medium">© 2026 Traffio Odonto Marketing. Todos os direitos reservados.</p>
                        <div className="flex gap-6 text-xs text-slate-500 font-medium">
                            <span className="cursor-pointer hover:text-graphite-300 transition-colors">Privacidade</span>
                            <span className="cursor-pointer hover:text-graphite-300 transition-colors">Termos de Uso</span>
                            <span className="cursor-pointer hover:text-graphite-300 transition-colors">Cookies</span>
                        </div>
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

// ── Soluções por especialidade ─────────────────────────────────────────────

const SOLUTIONS = [
    {
        icon: Stethoscope,
        bg: 'bg-brand-primary/10', color: 'text-brand-primary',
        title: 'Médico Autônomo',
        desc: 'Consultório solo com agenda online, prontuário e WhatsApp automático. Funcione sem secretária 24h por dia.',
        features: ['Agenda online 24/7', 'Lembretes automáticos', 'Prontuário digital', 'Portal do paciente'],
        plan: 'Plano Essencial — R$ 197/mês',
    },
    {
        icon: Users,
        bg: 'bg-indigo-50', color: 'text-indigo-500',
        title: 'Clínica Médica',
        desc: 'Múltiplos profissionais, CRM de pacientes e hub financeiro integrado em uma só plataforma.',
        features: ['Até 10 profissionais', 'Inbox WhatsApp', 'CRM + pipeline', 'Hub financeiro'],
        plan: 'Plano Clínica — R$ 397/mês',
    },
    {
        icon: Smile,
        bg: 'bg-sky-50', color: 'text-sky-500',
        title: 'Odontologia',
        desc: 'Odontograma digital, orçamentos, visualizador DICOM e controle de tratamentos por paciente.',
        features: ['Odontograma digital', 'Orçamentos de tratamento', 'DICOM (radiografias)', 'Parcelas via Dr. Cash'],
        plan: 'Plano Clínica — R$ 397/mês',
    },
    {
        icon: Leaf,
        bg: 'bg-emerald-50', color: 'text-emerald-600',
        title: 'Nutrição e Wellness',
        desc: 'Avaliação antropométrica, composição corporal e planos alimentares integrados ao prontuário.',
        features: ['Avaliação antropométrica', 'Composição corporal', 'Evolução de peso', 'Planos alimentares'],
        plan: 'Plano Essencial — R$ 197/mês',
    },
    {
        icon: Brain,
        bg: 'bg-violet-50', color: 'text-violet-500',
        title: 'Psicologia e Saúde Mental',
        desc: 'Prontuário adaptado, prescrições digitais e agendamento recorrente para terapias semanais.',
        features: ['Prontuário adaptado', 'Agendamento recorrente', 'Confirmação automática', 'Portal do paciente'],
        plan: 'Plano Essencial — R$ 197/mês',
    },
    {
        icon: Building2,
        bg: 'bg-amber-50', color: 'text-amber-500',
        title: 'Redes e Franquias',
        desc: 'Master Dashboard com visão centralizada de todas as unidades, faturamento consolidado e API dedicada.',
        features: ['Visão cross-unidade', 'Faturamento consolidado', 'Analytics da rede', 'API + webhooks'],
        plan: 'Plano Rede — R$ 897/mês',
    },
];

function SolutionCard({ sol, onStart }: { sol: typeof SOLUTIONS[0]; onStart: () => void }) {
    const Icon = sol.icon;
    return (
        <div className="bg-white rounded-[28px] border border-ice-100 p-8 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
            <div className={`w-14 h-14 ${sol.bg} ${sol.color} rounded-2xl flex items-center justify-center mb-5`}>
                <Icon size={26} />
            </div>
            <h3 className="text-xl font-black text-graphite-900 mb-3">{sol.title}</h3>
            <p className="text-sm text-graphite-500 font-medium leading-relaxed mb-5 flex-1">{sol.desc}</p>
            <ul className="space-y-2 mb-6">
                {sol.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-graphite-600 font-medium">
                        <Check size={14} className={sol.color} />
                        {f}
                    </li>
                ))}
            </ul>
            <div className="border-t border-ice-100 pt-5">
                <p className="text-xs font-black text-graphite-400 mb-3">{sol.plan}</p>
                <button onClick={onStart}
                    className={`w-full py-3 rounded-xl text-sm font-black transition-all border-none cursor-pointer flex items-center justify-center gap-2 ${sol.bg} ${sol.color} hover:opacity-80`}>
                    Começar trial grátis
                    <ArrowRight size={14} />
                </button>
            </div>
        </div>
    );
}

// ── Tabela de comparação ───────────────────────────────────────────────────

type CellVal = boolean | string | null;
interface CompRow { type: 'row' | 'header'; label: string; values: Record<PlanId, CellVal>; }

const COMPARISON_ROWS: CompRow[] = [
    { type: 'header', label: 'Agenda e Atendimento', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Agenda inteligente (drag-and-drop)', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Agendamento online 24/7', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Check-in digital e sala de espera', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Profissionais de saúde', values: { essencial: 'Até 2', clinica: 'Até 10', rede: 'Ilimitado' } },
    { type: 'row', label: 'Unidades / localizações', values: { essencial: '1', clinica: 'Até 3', rede: 'Ilimitado' } },
    { type: 'row', label: 'Lista de espera', values: { essencial: false, clinica: true, rede: true } },

    { type: 'header', label: 'Prontuário', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Prontuário eletrônico completo', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Upload de exames e documentos', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Receitas e prescrições digitais', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Explicação de termos médicos por IA', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Armazenamento', values: { essencial: '5 GB', clinica: '30 GB', rede: '200 GB' } },

    { type: 'header', label: 'WhatsApp e Comunicação', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Conexão WhatsApp próprio (Z-API)', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Lembretes automáticos (48h, 24h, 2h)', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Confirmação e NPS automáticos', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Inbox humano (kanban de conversas)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Envio de mídia (imagem, vídeo, áudio)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Números WhatsApp inclusos', values: { essencial: '1', clinica: '1', rede: '3' } },

    { type: 'header', label: 'CRM e Marketing', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Cadastro e gestão de pacientes/leads', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Kanban de follow-up (pipeline)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Integração Meta Ads + Google Ads', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Dashboard ROAS e conversão', values: { essencial: false, clinica: true, rede: true } },

    { type: 'header', label: 'Financeiro e Pagamentos', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Controle de cobranças manual', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Asaas (PIX automático, boleto, cartão)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Pagar.me (cartão de crédito)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Dr. Cash (financiamento)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Faturamento consolidado da rede', values: { essencial: false, clinica: false, rede: true } },

    { type: 'header', label: 'Módulos de Especialidade', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Módulos disponíveis', values: { essencial: '1 módulo', clinica: 'Todos', rede: 'Todos' } },
    { type: 'row', label: 'Odontograma digital + DICOM', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Avaliação antropométrica (nutrição)', values: { essencial: false, clinica: true, rede: true } },

    { type: 'header', label: 'Gestão e Suporte', values: { essencial: null, clinica: null, rede: null } },
    { type: 'row', label: 'Master Dashboard (visão da rede)', values: { essencial: false, clinica: false, rede: true } },
    { type: 'row', label: 'API dedicada e webhooks', values: { essencial: false, clinica: false, rede: true } },
    { type: 'row', label: 'Suporte por e-mail', values: { essencial: true, clinica: true, rede: true } },
    { type: 'row', label: 'Suporte por chat (horário comercial)', values: { essencial: false, clinica: true, rede: true } },
    { type: 'row', label: 'Onboarding assistido + migração', values: { essencial: false, clinica: false, rede: true } },
    { type: 'row', label: 'Gerente de sucesso dedicado', values: { essencial: false, clinica: false, rede: true } },
    { type: 'row', label: 'SLA de uptime 99.9%', values: { essencial: false, clinica: false, rede: true } },
];

function CellValue({ value }: { value: CellVal }) {
    if (value === true)  return <Check size={18} className="text-emerald-500 mx-auto" />;
    if (value === false) return <X     size={16} className="text-graphite-300 mx-auto" />;
    if (value === null)  return <Minus size={14} className="text-graphite-200 mx-auto" />;
    return <span className="font-bold text-graphite-700 text-xs">{value}</span>;
}
