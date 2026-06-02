import { useNavigate } from 'react-router-dom';
import {
    Activity,
    ShieldCheck,
    Zap,
    MessageCircle,
    ChevronRight,
    Globe,
    BarChart3,
    Users
} from 'lucide-react';

export const LandingPage = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-white">
            {/* Header / Nav */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-ice-200">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-brand-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/20">
                            <Activity size={24} />
                        </div>
                        <span className="text-2xl font-black text-graphite-900 tracking-tight">Traffio</span>
                    </div>

                    <div className="hidden md:flex items-center gap-8 text-sm font-bold text-graphite-500">
                        <a href="#features" className="hover:text-brand-primary transition-colors cursor-pointer text-inherit no-underline">Recursos</a>
                        <a href="#solutions" className="hover:text-brand-primary transition-colors cursor-pointer text-inherit no-underline">Soluções</a>
                        <a href="#pricing" className="hover:text-brand-primary transition-colors cursor-pointer text-inherit no-underline">Planos</a>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/login')}
                            className="hidden md:block text-sm font-bold text-graphite-600 hover:text-brand-primary transition-colors cursor-pointer border-none bg-transparent"
                        >
                            Entrar
                        </button>
                        <button
                            onClick={() => navigate('/register')}
                            className="px-6 py-2.5 bg-brand-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-primary/25 hover:scale-105 transition-transform border-none cursor-pointer"
                        >
                            Começar Agora
                        </button>
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <section className="pt-32 pb-20 md:pt-40 md:pb-32 px-6">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-secondary/10 text-brand-primary rounded-full text-xs font-black uppercase tracking-wider">
                            <Zap size={14} className="fill-brand-primary" />
                            A Nova Era da Gestão Clínica
                        </div>

                        <h1 className="text-5xl md:text-7xl font-black text-graphite-900 leading-[1.1] tracking-tight">
                            Gestão Hospitalar <br className="hidden md:block" />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-secondary">
                                Simples e Inteligente
                            </span>
                        </h1>

                        <p className="text-lg text-graphite-500 font-medium max-w-xl leading-relaxed">
                            O sistema operacional completo para clínicas e hospitais que buscam eficiência máxima. Prontuário, Financeiro e CRM em uma única plataforma.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={() => navigate('/register')}
                                className="px-8 py-4 bg-brand-primary text-white rounded-2xl text-lg font-bold shadow-xl shadow-brand-primary/25 hover:scale-105 active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer"
                            >
                                Criar Conta Grátis
                                <ChevronRight size={20} />
                            </button>
                            <button className="px-8 py-4 bg-white text-graphite-900 border border-ice-200 rounded-2xl text-lg font-bold hover:bg-ice-50 transition-all cursor-pointer">
                                Ver Demonstração
                            </button>
                        </div>

                        <div className="flex items-center gap-4 text-sm font-medium text-graphite-400 pt-4">
                            <span className="flex items-center gap-1"><ShieldCheck size={16} className="text-emerald-500" /> LGPD Compliant</span>
                            <span className="flex items-center gap-1"><Globe size={16} className="text-brand-primary" /> 100% Nuvem</span>
                        </div>
                    </div>

                    <div className="relative animate-in fade-in slide-in-from-right-8 duration-1000 delay-200">
                        <div className="absolute -inset-4 bg-gradient-to-tr from-brand-primary/20 to-brand-secondary/20 rounded-[40px] blur-3xl opacity-50" />
                        <img
                            src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80"
                            alt="Dashboard Interface"
                            className="relative rounded-[32px] shadow-2xl border-4 border-white transform rotate-2 hover:rotate-0 transition-transform duration-500"
                        />
                        {/* Floating Cards */}
                        <div className="absolute -bottom-10 -left-10 bg-white p-6 rounded-2xl shadow-xl border border-ice-100 animate-bounce delay-700 duration-[3000ms]">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                                    <BarChart3 size={24} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-graphite-400 uppercase">Faturamento</p>
                                    <p className="text-xl font-black text-graphite-900">+127%</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section className="py-24 bg-ice-50/50">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center max-w-2xl mx-auto mb-16">
                        <h2 className="text-4xl font-black text-graphite-900 mb-4 tracking-tight">Tudo que você precisa</h2>
                        <p className="text-graphite-500 text-lg">Uma suíte completa de ferramentas integradas para transformar a gestão da sua instituição.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <FeatureCard
                            icon={MessageCircle}
                            title="Comunicação Inteligente"
                            desc="WhatsApp integrado, confirmações automáticas e chat interno para sua equipe."
                            color="text-violet-500"
                            bg="bg-violet-100"
                        />
                        <FeatureCard
                            icon={BarChart3}
                            title="Financeiro Completo"
                            desc="Emissão de boletos, Pix automatizado, DRE e controle de repasses médicos."
                            color="text-emerald-500"
                            bg="bg-emerald-100"
                        />
                        <FeatureCard
                            icon={Users}
                            title="Prontuário Integrado"
                            desc="Histórico completo do paciente, prescrição digital e agendamento online."
                            color="text-brand-primary"
                            bg="bg-brand-primary/10"
                        />
                    </div>
                </div>
            </section>
        </div>
    );
};

const FeatureCard = ({ icon: Icon, title, desc, color, bg }: any) => (
    <div className="bg-white p-8 rounded-[32px] border border-ice-100 hover:shadow-xl hover:-translate-y-2 transition-all duration-300">
        <div className={`w-14 h-14 ${bg} ${color} rounded-2xl flex items-center justify-center mb-6`}>
            <Icon size={28} />
        </div>
        <h3 className="text-xl font-black text-graphite-900 mb-3">{title}</h3>
        <p className="text-graphite-500 leading-relaxed font-medium">
            {desc}
        </p>
    </div>
);
