import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Building2,
    MessageSquare,
    Settings,
    LogOut,
    Menu,
    X,
    Server,
    ShieldAlert,
    BrainCircuit,
    CreditCard,
    BookOpen,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MasterDashboard } from './MasterDashboard';
import { MasterTenants } from './MasterTenants';
import { MasterWhatsApp } from './MasterWhatsApp';
import { MasterIntelligence } from './MasterIntelligence';
import { MasterBilling } from './MasterBilling';
import { MasterKnowledge } from './MasterKnowledge';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export const MasterApp = () => {
    const { t } = useTranslation('master');
    const [isSidebarOpen] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const navItems = [
        { id: 'dashboard', label: t('app.nav.dashboard'), icon: LayoutDashboard, path: '/master/dashboard' },
        { id: 'tenants', label: t('app.nav.tenants'), icon: Building2, path: '/master/tenants' },
        { id: 'whatsapp', label: t('app.nav.whatsapp'), icon: MessageSquare, path: '/master/whatsapp', badge: t('app.nav.whatsappBadge') },
        { id: 'intelligence', label: t('app.nav.intelligence'), icon: BrainCircuit, path: '/master/intelligence', badge: t('app.nav.intelligenceBadge') },
        { id: 'knowledge', label: t('app.nav.knowledge'), icon: BookOpen, path: '/master/knowledge' },
        { id: 'billing', label: t('app.nav.billing'), icon: CreditCard, path: '/master/billing' },
        { id: 'logs', label: t('app.nav.logs'), icon: Server, path: '/master/logs' },
        { id: 'settings', label: t('app.nav.settings'), icon: Settings, path: '/master/settings' },
    ];

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-[#0B101F] font-display text-slate-200 selection:bg-indigo-500/30">
            {/* Desktop Sidebar */}
            <aside
                className={clsx(
                    "fixed left-0 top-0 h-full bg-[#0F1629] border-r border-[#1E293B] z-50 transition-all duration-300 hidden lg:flex flex-col",
                    isSidebarOpen ? "w-64" : "w-20"
                )}
            >
                {/* Logo */}
                <div className="h-20 flex items-center px-6 border-b border-[#1E293B]">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
                            <ShieldAlert className="text-white" size={18} />
                        </div>
                        <span className={clsx("font-black text-lg tracking-tight text-white transition-opacity duration-300 whitespace-nowrap", !isSidebarOpen && "opacity-0")}>
                            MASTER <span className="text-indigo-400">ADMIN</span>
                        </span>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-6 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <button
                                key={item.id}
                                onClick={() => navigate(item.path)}
                                className={clsx(
                                    "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative border-none cursor-pointer",
                                    isActive
                                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                                        : "hover:bg-[#1A2035] text-slate-400 hover:text-white bg-transparent"
                                )}
                            >
                                <item.icon size={20} className={clsx("shrink-0", isActive ? "text-white" : "text-slate-500 group-hover:text-indigo-400")} />

                                <span className={clsx("font-bold text-sm transition-opacity duration-300 whitespace-nowrap", !isSidebarOpen && "opacity-0 absolute")}>
                                    {item.label}
                                </span>

                                {item.badge && isSidebarOpen && (
                                    <span className="ml-auto text-[10px] font-black uppercase bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-md border border-indigo-500/20">
                                        {item.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-[#1E293B]">
                    <button
                        onClick={handleSignOut}
                        className={clsx(
                            "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-all border-none bg-transparent cursor-pointer",
                            !isSidebarOpen && "justify-center px-0"
                        )}
                    >
                        <LogOut size={20} />
                        <span className={clsx("font-bold text-sm", !isSidebarOpen && "hidden")}>{t('app.signOut')}</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className={clsx("min-h-screen transition-all duration-300", isSidebarOpen ? "lg:pl-64" : "lg:pl-20")}>
                {/* Mobile Header */}
                <header className="lg:hidden h-16 bg-[#0F1629] border-b border-[#1E293B] flex items-center justify-between px-4 sticky top-0 z-40">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
                            <ShieldAlert className="text-white" size={18} />
                        </div>
                        <span className="font-black text-lg tracking-tight text-white">MASTER</span>
                    </div>
                    <button
                        onClick={() => setIsMobileMenuOpen(true)}
                        className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white bg-transparent border-none"
                    >
                        <Menu size={24} />
                    </button>
                </header>

                <div className="p-4 lg:p-8">
                    <Routes>
                        <Route path="/" element={<Navigate to="/master/dashboard" replace />} />
                        <Route path="dashboard" element={<MasterDashboard />} />
                        <Route path="tenants" element={<MasterTenants />} />
                        <Route path="whatsapp" element={<MasterWhatsApp />} />
                        <Route path="intelligence" element={<MasterIntelligence />} />
                        <Route path="knowledge" element={<MasterKnowledge />} />
                        <Route path="billing" element={<MasterBilling />} />
                        <Route path="logs" element={<div className="p-8 text-center text-slate-500">{t('app.logsPlaceholder')}</div>} />
                        <Route path="settings" element={<div className="p-8 text-center text-slate-500">{t('app.settingsPlaceholder')}</div>} />
                        <Route path="*" element={<Navigate to="/master/dashboard" replace />} />
                    </Routes>
                </div>
            </main>

            {/* Mobile Sidebar Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 lg:hidden"
                            onClick={() => setIsMobileMenuOpen(false)}
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            className="fixed left-0 top-0 bottom-0 w-72 bg-[#0F1629] border-r border-[#1E293B] z-50 lg:hidden flex flex-col p-6"
                        >
                            <div className="flex items-center justify-between mb-8">
                                <span className="font-black text-xl text-white">{t('app.menu')}</span>
                                <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-500 hover:text-white bg-transparent border-none">
                                    <X size={24} />
                                </button>
                            </div>

                            <nav className="space-y-2 flex-1">
                                {navItems.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => {
                                            navigate(item.path);
                                            setIsMobileMenuOpen(false);
                                        }}
                                        className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-slate-400 hover:bg-[#1A2035] hover:text-white transition-all border-none bg-transparent"
                                    >
                                        <item.icon size={22} />
                                        <span className="font-bold">{item.label}</span>
                                    </button>
                                ))}
                            </nav>

                            <button
                                onClick={handleSignOut}
                                className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all border-none bg-transparent mt-auto"
                            >
                                <LogOut size={22} />
                                <span className="font-bold">{t('app.signOut')}</span>
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
