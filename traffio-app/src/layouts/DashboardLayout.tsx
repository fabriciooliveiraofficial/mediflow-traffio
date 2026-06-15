import React, { useState, useEffect, useRef } from 'react';
import {
    LayoutDashboard,
    Calendar,
    Users,
    BarChart3,
    Settings,
    ChevronLeft,
    ChevronRight,
    Search,
    Bell,
    Menu,
    X,
    Plus,
    MessageCircle,
    Headphones,
    Stethoscope,
    Tag,
    LogOut,
    Apple,
    Brain,
    ChevronDown,
    PhoneCall,
    CreditCard,
    Crown,
    Phone,
} from 'lucide-react'
// Phone used in navItems below
import { FloatingCommunicationsButton } from '../components/softphone/FloatingCommunicationsButton'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions, PERMISSION_MAP } from '../hooks/usePermissions'
import { Activity } from 'lucide-react'

// ─── Sound alert via Web Audio API (no external files needed) ───────────────
function playHandoffSound() {
    try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        if (!Ctx) return
        const ctx = new Ctx()
        const playTone = (freq: number, start: number, dur: number, vol = 0.22) => {
            const osc  = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0, start)
            gain.gain.linearRampToValueAtTime(vol, start + 0.01)
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
            osc.start(start); osc.stop(start + dur)
        }
        playTone(1047, ctx.currentTime,        0.18)   // C6
        playTone(1319, ctx.currentTime + 0.18, 0.18)   // E6
        playTone(1568, ctx.currentTime + 0.36, 0.28)   // G6
        setTimeout(() => ctx.close(), 1200)
    } catch { /* AudioContext not available */ }
}

interface NavItem {
    id: string
    label: string
    icon: any
    badge?: string
    isSubItem?: boolean
    parentId?: string
}

const navItems: NavItem[] = [
    { id: 'agenda', label: 'Agenda', icon: Calendar, badge: 'IA' },
    { id: 'reception', label: 'Recepção', icon: Users, badge: 'Staff' },
    { id: 'inbox', label: 'Atendimento', icon: Headphones, badge: 'Inbox' },
    { id: 'followup', label: 'Follow-up (CRM)', icon: LayoutDashboard },
    { id: 'leads', label: 'Pacientes', icon: Users },
    { id: 'analytics', label: 'Financeiro', icon: BarChart3 },
    { id: 'professionals', label: 'Corpo Clínico', icon: Stethoscope },
    { id: 'services', label: 'Procedimentos', icon: Tag },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, badge: 'Z-API' },
    { id: 'communications', label: 'Comunicações', icon: Phone, badge: 'Softphone' },
    { id: 'intelligence', label: 'Inteligência', icon: Brain, badge: 'AI Hub' },
    { id: 'dashboard', label: 'Analytics Pro', icon: LayoutDashboard },
    { id: 'notifications', label: 'Notificações', icon: Bell },
    { id: 'payments', label: 'Pagamentos', icon: CreditCard },
    { id: 'billing', label: 'Assinatura', icon: Crown },
    { id: 'settings', label: 'Configurações', icon: Settings },
];

interface HandoffAlert {
    id: string
    phone: string
    arrivedAt: string
}

export const DashboardLayout = ({ children, activeScreen, onNavigate }: {
    children: React.ReactNode,
    activeScreen: string,
    onNavigate: (id: string) => void
}) => {
    const { tenant, loading: isTenantLoading, userRole } = useTenant()
    const { user: authUser } = useAuth()
    const { can } = usePermissions()
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const [scrolled, setScrolled] = useState(false)
    const [expandedMenus, setExpandedMenus] = useState<string[]>([])
    const [profile, setProfile] = useState<{ full_name: string; role: string } | null>(null)

    // ── Human handoff alert system ────────────────
    const [queuedCount, setQueuedCount]     = useState(0)
    const [alerts, setAlerts]               = useState<HandoffAlert[]>([])
    const prevCountRef                       = useRef(0)
    const soundEnabledRef                    = useRef(false) // only play after first user gesture

    // Enable sound after first interaction (browser autoplay policy)
    useEffect(() => {
        const enable = () => { soundEnabledRef.current = true }
        window.addEventListener('click', enable, { once: true })
        window.addEventListener('keydown', enable, { once: true })
        return () => {
            window.removeEventListener('click', enable)
            window.removeEventListener('keydown', enable)
        }
    }, [])

    useEffect(() => {
        if (!tenant?.id) return

        const fetchQueue = async () => {
            const { data } = await supabase
                .from('conversation_sessions')
                .select('id, patient_phone, updated_at')
                .eq('tenant_id', tenant.id)
                .eq('omnichannel_status', 'queued')
                .order('updated_at', { ascending: false })
            return data ?? []
        }

        // Initial load
        fetchQueue().then(data => {
            setQueuedCount(data.length)
            prevCountRef.current = data.length
        })

        // Request browser notification permission
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission()
        }

        const channel = supabase
            .channel(`handoff-monitor:${tenant.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'conversation_sessions',
                filter: `tenant_id=eq.${tenant.id}`,
            }, async () => {
                const data = await fetchQueue()
                const newCount = data.length

                if (newCount > prevCountRef.current) {
                    // New conversation(s) entered the queue
                    if (soundEnabledRef.current) playHandoffSound()

                    const newSessions = data.slice(0, newCount - prevCountRef.current)
                    setAlerts(prev => [
                        ...newSessions.map(s => ({
                            id: s.id,
                            phone: s.patient_phone,
                            arrivedAt: s.updated_at ?? new Date().toISOString(),
                        })),
                        ...prev,
                    ])

                    // Browser notification when tab not focused
                    if (typeof Notification !== 'undefined' &&
                        Notification.permission === 'granted' &&
                        document.hidden) {
                        new Notification('Traffio Med — Atendimento aguardando', {
                            body: `Um paciente entrou na fila e precisa de atendimento humano.`,
                            icon: '/favicon.ico',
                            tag: 'handoff',
                        })
                    }
                }

                setQueuedCount(newCount)
                prevCountRef.current = newCount
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [tenant?.id])
    useEffect(() => {
        if (!authUser) return;
        const fetchProfile = async () => {
            const { data: profileData } = await supabase
                .from('profiles')
                .select('full_name, role')
                .eq('id', authUser.id)
                .maybeSingle()

            setProfile({
                full_name: profileData?.full_name || authUser.user_metadata?.full_name || 'Usuário',
                role: profileData?.role || 'staff'
            })
        }
        fetchProfile()
    }, [authUser?.id])

    const navigate = useNavigate()

    // Adapt navigation items based on specialty using useMemo for stability and performance
    const adaptiveNavItems = React.useMemo(() => {
        let items = [...navItems];
        const specialties = tenant?.specialty || [];

        // 1. Encontrar o ponto de inserção após 'Procedimentos'
        const servicesIndex = items.findIndex(i => i.id === 'services');
        if (servicesIndex === -1) return items;

        let insertionPoint = servicesIndex + 1;

        // 2. Injetar Odontologia se aplicável
        if (specialties.includes('dental')) {
            const dentalItems: NavItem[] = [
                { id: 'odontology', label: 'Odontologia', icon: Activity, badge: 'New' },
                { id: 'odontogram', label: 'Odontograma', icon: Activity, isSubItem: true, parentId: 'odontology' }
            ];
            items.splice(insertionPoint, 0, ...dentalItems);
            insertionPoint += dentalItems.length;
        }

        // 3. Injetar Prontuário se aplicável
        if (specialties.includes('general')) {
            const medicalRecordItem: NavItem = { id: 'medical-records', label: 'Prontuário', icon: Stethoscope, badge: 'New' };
            items.splice(insertionPoint, 0, medicalRecordItem);
            insertionPoint += 1;
        }

        // 4. Injetar Nutrição se aplicável
        if (specialties.includes('nutrition')) {
            const nutritionItems: NavItem[] = [
                { id: 'nutrition', label: 'Nutrição', icon: Apple, badge: 'New' },
                { id: 'nutrition-plan', label: 'Plano Nutricional', icon: Apple, isSubItem: true, parentId: 'nutrition' }
            ];
            items.splice(insertionPoint, 0, ...nutritionItems);
            insertionPoint += nutritionItems.length;
        }

        return items;
    }, [tenant?.specialty]);

    // Filter nav items by permission (only when userRole is resolved)
    const filteredNavItems = React.useMemo(() => {
        if (!userRole) return adaptiveNavItems; // ainda carregando — mostrar tudo
        return adaptiveNavItems.filter(item => {
            const permKey = `page:${item.id}`;
            if (!PERMISSION_MAP[permKey]) return true; // sem restrição → mostrar
            return can(permKey);
        });
    }, [adaptiveNavItems, userRole, can]);

    // Auto-expand parent if sub-item is active
    useEffect(() => {
        const activeItem = filteredNavItems.find(i => i.id === activeScreen);
        if (activeItem?.parentId && !expandedMenus.includes(activeItem.parentId)) {
            setExpandedMenus(prev => [...prev, activeItem.parentId as string]);
        }
    }, [activeScreen, filteredNavItems]);

    const handleItemClick = (item: NavItem) => {
        const hasSubItems = filteredNavItems.some(i => i.parentId === item.id);
        
        if (hasSubItems) {
            setExpandedMenus(prev => 
                prev.includes(item.id) 
                    ? prev.filter(id => id !== item.id) 
                    : [...prev, item.id]
            );
        }
        
        onNavigate(item.id);
    };

    const handleSignOut = async () => {
        const token = localStorage.getItem('traffio_session_token')
        if (token) {
            try {
                await supabase.rpc('deactivate_session', { p_session_id: token })
            } catch (err) {
                console.error('[DashboardLayout] Erro ao desativar sessão no logout:', err)
            }
            localStorage.removeItem('traffio_session_token')
        }
        await supabase.auth.signOut()
        navigate('/login', { replace: true })
    }

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20)
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <div className="min-h-screen bg-background-light font-display text-graphite-900 selection:bg-brand-primary/20 bg-[#F7F9FC]">
            {/* Desktop Sidebar */}
            <aside
                className={clsx(
                    "fixed left-0 top-0 h-full bg-white border-r border-ice-100 z-50 transition-all duration-500 ease-in-out hidden lg:flex flex-col no-print",
                    isSidebarOpen ? "w-72" : "w-24"
                )}
            >
                {/* Logo Section */}
                <div className="h-20 flex items-center justify-center px-4 overflow-hidden shrink-0">
                    {isSidebarOpen
                        ? <img src="/logo_dark.png" alt="Traffio" className="h-14 w-auto object-contain" />
                        : <img src="/favicon.png"   alt="Traffio" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    }
                </div>

                {/* Nav Items */}
                <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto overflow-x-hidden custom-scrollbar relative">
                    <motion.div layout className="space-y-1">
                        {isTenantLoading && !tenant ? (
                            // Loading Skeletons to preserve space
                            <>
                                {[1, 2, 3, 4, 5, 6].map((i) => (
                                    <div key={`skeleton-${i}`} className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-ice-50/50 animate-pulse">
                                        <div className="w-5 h-5 bg-ice-100 rounded-lg shrink-0" />
                                        <div className={clsx("h-4 bg-ice-100 rounded-md transition-all duration-300", isSidebarOpen ? "w-32" : "w-0 opacity-0")} />
                                    </div>
                                ))}
                            </>
                        ) : (
                            filteredNavItems.map((item) => {
                                const isActive = activeScreen === item.id;
                                const hasSubItems = filteredNavItems.some(i => i.parentId === item.id);
                                const isSubItem = !!item.isSubItem;

                                // Only show sub-item if its parent is expanded
                                if (isSubItem && !expandedMenus.includes(item.parentId || '')) return null;

                                return (
                                    <motion.div
                                        key={item.id}
                                        layout
                                        initial={isSubItem ? { opacity: 0, height: 0 } : { opacity: 0 }}
                                        animate={isSubItem ? { opacity: 1, height: 'auto' } : { opacity: 1 }}
                                        exit={isSubItem ? { opacity: 0, height: 0 } : { opacity: 0 }}
                                        transition={{ 
                                            layout: { type: "spring", stiffness: 300, damping: 30 },
                                            opacity: { duration: 0.2 }
                                        }}
                                    >
                                        <button
                                            onClick={() => handleItemClick(item)}
                                            className={clsx(
                                                "w-full group relative flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 border-none cursor-pointer",
                                                isActive
                                                    ? "bg-brand-primary shadow-xl shadow-brand-primary/20"
                                                    : "bg-transparent hover:bg-ice-50",
                                                isSubItem && "pl-12 py-2.5 mt-0.5"
                                            )}
                                        >
                                            <item.icon
                                                size={isSubItem ? 18 : 22}
                                                className={clsx(
                                                    "shrink-0 transition-colors duration-300",
                                                    isActive ? "text-white" : "text-brand-primary"
                                                )}
                                            />
                                            <span className={clsx(
                                                "font-bold tracking-tight transition-all duration-300 whitespace-nowrap",
                                                isSubItem ? "text-xs" : "text-sm",
                                                isActive ? "text-white" : "text-graphite-700 group-hover:text-graphite-900",
                                                !isSidebarOpen && "opacity-0 invisible translate-x-4 absolute"
                                            )}>
                                                {item.label}
                                            </span>
                                            
                                            {isSidebarOpen && !isSubItem && (item.id === 'inbox' ? (
                                                // Live queue badge for Atendimento Humano
                                                queuedCount > 0 ? (
                                                    <span className={clsx(
                                                        "ml-auto px-2 py-0.5 rounded-lg text-[10px] font-black animate-pulse",
                                                        isActive ? "bg-white/20 text-white" : "bg-red-500 text-white"
                                                    )}>
                                                        {queuedCount}
                                                    </span>
                                                ) : item.badge ? (
                                                    <span className={clsx(
                                                        "ml-auto px-2 py-0.5 rounded-lg text-[10px] font-black",
                                                        isActive ? "bg-white/20 text-white" : "bg-brand-secondary text-brand-primary"
                                                    )}>
                                                        {item.badge}
                                                    </span>
                                                ) : null
                                            ) : item.badge ? (
                                                <span className={clsx(
                                                    "ml-auto px-2 py-0.5 rounded-lg text-[10px] font-black",
                                                    isActive ? "bg-white/20 text-white" : "bg-brand-secondary text-brand-primary"
                                                )}>
                                                    {item.badge}
                                                </span>
                                            ) : null)}

                                            {hasSubItems && isSidebarOpen && (
                                                <div className={clsx(
                                                    "ml-auto transition-transform duration-300",
                                                    expandedMenus.includes(item.id) ? "rotate-180" : ""
                                                )}>
                                                    <ChevronDown size={14} className={isActive ? "text-white" : "text-graphite-300"} />
                                                </div>
                                            )}
                                        </button>
                                    </motion.div>
                                );
                            })
                        )}
                    </motion.div>

                </nav>

                {/* Sidebar Toggle */}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="absolute -right-4 top-10 w-8 h-8 bg-white border border-ice-100 rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-all cursor-pointer z-50 group"
                >
                    {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>

                {/* Footer User Profile + Sign Out */}
                <div className="p-6 border-t border-ice-50 space-y-3">
                    <div className={clsx("flex flex-col p-3 rounded-2xl bg-ice-50/50 transition-all duration-300", !isSidebarOpen && "opacity-0")}>
                        <p className="text-xs font-black text-graphite-900 truncate">{profile?.full_name || 'Carregando...'}</p>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className={clsx(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-rose-500 hover:bg-rose-50 transition-all border-none cursor-pointer bg-transparent",
                            !isSidebarOpen && "justify-center px-0"
                        )}
                    >
                        <LogOut size={18} className="shrink-0" />
                        <span className={clsx("font-bold text-sm", !isSidebarOpen && "hidden")}>Sair</span>
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main
                className={clsx(
                    "transition-all duration-500 ease-in-out",
                    // Inbox e Communications: tela cheia sem scroll externo
                    (activeScreen === 'inbox' || activeScreen === 'communications')
                        ? "h-screen flex flex-col overflow-hidden"
                        : "min-h-screen",
                    isSidebarOpen ? "lg:pl-72" : "lg:pl-24"
                )}
            >
                {/* Global Header — oculto na página de comunicações (tem nav própria) */}
                <header
                    className={clsx(
                        "sticky top-0 z-40 transition-all duration-300 px-6 lg:px-12 py-4 flex items-center justify-between no-print",
                        activeScreen === 'communications' ? "hidden" : "",
                        scrolled ? "bg-[#F7F9FC]/80 backdrop-blur-xl border-b border-ice-100/50 py-3" : "bg-transparent"
                    )}
                >
                    <div className="flex items-center gap-3 lg:gap-6 flex-1 min-w-0">
                        {/* Mobile Menu Toggle */}
                        <button
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="lg:hidden w-12 h-12 flex items-center justify-center bg-white rounded-2xl shadow-sm border-none cursor-pointer shrink-0"
                        >
                            <Menu size={24} />
                        </button>

                        {activeScreen === 'inbox' || activeScreen === 'communications' ? (
                            <div id="inbox-header-slot" className="flex-1 w-full min-w-0" />
                        ) : (
                            <div className="hidden lg:flex items-center gap-3 bg-white border border-ice-100 px-4 py-2.5 rounded-2xl w-full max-w-md shadow-sm group hover:border-brand-primary/30 transition-all">
                                <Search size={18} className="text-graphite-400 group-focus-within:text-brand-primary transition-colors" />
                                <input
                                    type="text"
                                    placeholder="Busca global integrada..."
                                    className="bg-transparent border-none outline-none text-sm font-medium w-full placeholder:text-graphite-300"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 lg:gap-4">
                        {activeScreen !== 'inbox' && (
                            <button className="lg:hidden w-12 h-12 flex items-center justify-center bg-white rounded-2xl shadow-sm border-none cursor-pointer">
                                <Search size={20} />
                            </button>
                        )}
                        <button className="w-12 h-12 flex items-center justify-center bg-white rounded-2xl shadow-sm group hover:scale-105 transition-all border-none relative cursor-pointer">
                            <Bell size={20} className="group-hover:text-brand-primary" />
                            <span className="absolute top-3 right-3 w-2 h-2 bg-brand-primary rounded-full border-2 border-white"></span>
                        </button>
                    </div>
                </header>

                {/* Page Content */}
                {activeScreen === 'inbox' || activeScreen === 'communications' ? (
                    // Tela cheia sem padding — ocupa todo o espaço restante após o header
                    <div className="flex-1 overflow-hidden">
                        {children}
                    </div>
                ) : (
                    <div className="px-6 lg:px-12 py-8">
                        {children}
                    </div>
                )}
            </main>

            {/* Mobile Tab Bar (iOS/Android Style) */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-ice-100 z-50 px-6 py-2 pb-8 flex justify-between items-center transition-all duration-300 no-print">
                {isTenantLoading && !tenant ? (
                    <div className="w-full flex justify-around items-center">
                        {[1, 2, 3, 4].map(i => (
                            <div key={`mob-skeleton-${i}`} className="flex flex-col items-center gap-2">
                                <div className="w-6 h-6 bg-ice-100 rounded-lg animate-pulse" />
                                <div className="w-8 h-2 bg-ice-50 rounded-full animate-pulse" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                        {filteredNavItems.slice(0, 2).map((item) => (
                            <button
                                key={item.id}
                                onClick={() => onNavigate(item.id)}
                                className={clsx(
                                    "flex flex-col items-center gap-1 p-2 border-none bg-transparent cursor-pointer transition-all",
                                    activeScreen === item.id ? "text-brand-primary" : "text-graphite-300"
                                )}
                            >
                                <item.icon size={22} className={activeScreen === item.id ? "stroke-[3px]" : "stroke-[2px]"} />
                                <span className="text-[10px] font-black uppercase tracking-tighter">{item.label.split(' ')[0]}</span>
                            </button>
                        ))}

                        {/* Floating Action Button (Mobile) */}
                        <div className="relative -top-6">
                            <button className="w-14 h-14 bg-brand-primary text-white rounded-full shadow-xl shadow-brand-primary/40 flex items-center justify-center border-none cursor-pointer active:scale-90 transition-transform">
                                <Plus size={28} />
                            </button>
                        </div>

                        {filteredNavItems.slice(2, 4).map((item) => (
                            <button
                                key={item.id}
                                onClick={() => onNavigate(item.id)}
                                className={clsx(
                                    "flex flex-col items-center gap-1 p-2 border-none bg-transparent cursor-pointer transition-all",
                                    activeScreen === item.id ? "text-brand-primary" : "text-graphite-300"
                                )}
                            >
                                <item.icon size={22} className={activeScreen === item.id ? "stroke-[3px]" : "stroke-[2px]"} />
                                <span className="text-[10px] font-black uppercase tracking-tighter">{item.label.split(' ')[0]}</span>
                            </button>
                        ))}
                    </>
                )}
            </nav>

            {/* ── Human Handoff Alert Banner ───────────────────────────────────── */}
            {/* Persistent, stacked alerts — one card per queued conversation     */}
            <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none no-print">
                <AnimatePresence>
                    {alerts.map((alert, i) => {
                        const waitMin = Math.floor((Date.now() - new Date(alert.arrivedAt).getTime()) / 60000)
                        return (
                            <motion.div
                                key={alert.id}
                                initial={{ opacity: 0, y: 40, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                                transition={{ type: 'spring', stiffness: 280, damping: 22, delay: i * 0.06 }}
                                className="pointer-events-auto bg-white border border-red-200 rounded-2xl shadow-2xl shadow-red-500/15 overflow-hidden"
                            >
                                {/* Red accent bar */}
                                <div className="h-1 bg-gradient-to-r from-red-500 to-orange-400" />

                                <div className="p-4 flex items-start gap-3">
                                    {/* Pulsing icon */}
                                    <div className="relative shrink-0 mt-0.5">
                                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                            <PhoneCall className="w-5 h-5 text-red-600" />
                                        </div>
                                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white animate-ping" />
                                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-gray-900">Atendimento Humano</p>
                                        <p className="text-xs text-gray-500 truncate mt-0.5">
                                            Paciente <span className="font-semibold text-gray-700">{alert.phone}</span> aguardando
                                        </p>
                                        <p className={clsx(
                                            "text-xs font-semibold mt-1",
                                            waitMin >= 5 ? "text-red-600" : "text-amber-600"
                                        )}>
                                            {waitMin === 0 ? 'Acabou de entrar na fila' : `Aguardando há ${waitMin} min`}
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                        aria-label="Dispensar"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>

                                <div className="px-4 pb-4 flex gap-2">
                                    <button
                                        onClick={() => {
                                            onNavigate('inbox')
                                            setAlerts(prev => prev.filter(a => a.id !== alert.id))
                                        }}
                                        className="flex-1 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors"
                                    >
                                        Atender agora
                                    </button>
                                    <button
                                        onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                                        className="py-2 px-3 rounded-xl border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors"
                                    >
                                        Depois
                                    </button>
                                </div>
                            </motion.div>
                        )
                    })}
                </AnimatePresence>
            </div>

            {/* Mobile Sidebar Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[60] lg:hidden"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed left-0 top-0 bottom-0 w-80 bg-white z-[70] lg:hidden p-8 flex flex-col"
                        >
                            <div className="flex items-center justify-between mb-12">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-brand-primary rounded-2xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                                        <span className="text-white font-black text-xl italic leading-none">T</span>
                                    </div>
                                    <span className="font-black text-xl tracking-tighter">Traffio <span className="text-brand-primary">Med</span></span>
                                </div>
                                <button
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="w-10 h-10 flex items-center justify-center bg-ice-50 rounded-xl border-none cursor-pointer"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <nav className="flex-1 space-y-4">
                                {filteredNavItems.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => {
                                            onNavigate(item.id)
                                            setIsMobileMenuOpen(false)
                                        }}
                                        className={clsx(
                                            "w-full flex items-center gap-5 px-6 py-5 rounded-3xl transition-all border-none bg-transparent cursor-pointer",
                                            activeScreen === item.id
                                                ? "bg-brand-primary text-white shadow-xl shadow-brand-primary/20"
                                                : "text-graphite-400 hover:bg-ice-50"
                                        )}
                                    >
                                        <item.icon size={24} className={activeScreen === item.id ? "text-white" : "text-brand-primary"} />
                                        <span className="font-bold text-lg">{item.label}</span>
                                        {item.badge && (
                                            <span className="ml-auto px-2 py-0.5 bg-brand-secondary text-[10px] font-black rounded-lg text-graphite-900">
                                                {item.badge}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </nav>

                            <div className="mt-auto space-y-3">
                                <div className="p-6 bg-ice-50/50 rounded-[32px]">
                                    <p className="font-black text-sm text-graphite-900">{profile?.full_name || 'Carregando...'}</p>
                                </div>
                                <button
                                    onClick={handleSignOut}
                                    className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-rose-500 hover:bg-rose-50 transition-all border-none cursor-pointer bg-transparent"
                                >
                                    <LogOut size={20} />
                                    <span className="font-bold">Sair da Conta</span>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Botão flutuante de comunicações — arrastável, sempre visível */}
            <FloatingCommunicationsButton
                enabled={!!(tenant as any)?.telnyx_enabled}
                tenantId={(tenant as any)?.id}
            />
        </div>
    )
}
