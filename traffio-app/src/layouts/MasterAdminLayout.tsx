import { useState } from 'react';
import {
    LayoutDashboard,
    Users,
    MessageCircle,
    CreditCard,
    ScrollText,
    ChevronLeft,
    ChevronRight,
    Shield,
    Menu,
    X,
    LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface NavItem {
    id: string;
    label: string;
    icon: any;
    badge?: string;
}

export const MasterAdminLayout = ({ children, activeScreen, onNavigate }: {
    children: React.ReactNode,
    activeScreen: string,
    onNavigate: (id: string) => void
}) => {
    const { t } = useTranslation('master');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const navigate = useNavigate();

    const navItems: NavItem[] = [
        { id: 'dashboard', label: t('adminLayout.nav.dashboard'), icon: LayoutDashboard },
        { id: 'tenants', label: t('adminLayout.nav.tenants'), icon: Users, badge: t('adminLayout.nav.tenantsBadge') },
        { id: 'whatsapp', label: t('adminLayout.nav.whatsapp'), icon: MessageCircle },
        { id: 'billing', label: t('adminLayout.nav.billing'), icon: CreditCard },
        { id: 'logs', label: t('adminLayout.nav.logs'), icon: ScrollText },
    ];

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/login', { replace: true });
    };

    return (
        <div className="min-h-screen bg-[#060B18] font-display text-white selection:bg-emerald-500/20">

            {/* Desktop Sidebar */}
            <aside
                className={clsx(
                    "fixed left-0 top-0 h-full bg-[#0A1128] border-r border-[#1E293B]/50 z-50 transition-all duration-500 ease-in-out hidden lg:flex flex-col",
                    isSidebarOpen ? "w-72" : "w-24"
                )}
            >
                {/* Logo */}
                <div className="h-24 flex items-center px-8 justify-between border-b border-[#1E293B]/50">
                    <div className={clsx("flex items-center gap-3 overflow-hidden transition-all duration-300", !isSidebarOpen && "opacity-0 invisible")}>
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                            <Shield className="text-white" size={20} />
                        </div>
                        <span className="font-black text-xl tracking-tighter whitespace-nowrap text-white">Traffio <span className="text-emerald-400">Master</span></span>
                    </div>
                    {!isSidebarOpen && (
                        <div className="w-10 h-10 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto">
                            <Shield className="text-emerald-400" size={20} />
                        </div>
                    )}
                </div>

                {/* Nav */}
                <nav className="flex-1 px-4 space-y-1 mt-6">
                    <p className={clsx("text-[10px] font-black uppercase tracking-widest text-slate-500 px-4 mb-3 transition-opacity", !isSidebarOpen && "opacity-0")}>
                        {t('adminLayout.platformControl')}
                    </p>
                    {navItems.map((item) => {
                        const isActive = activeScreen === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => { onNavigate(item.id); setIsMobileMenuOpen(false); }}
                                className={clsx(
                                    "w-full group relative flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-300 border-none cursor-pointer",
                                    isActive
                                        ? "bg-emerald-500/15 border border-emerald-500/20"
                                        : "bg-transparent hover:bg-white/5"
                                )}
                            >
                                <item.icon
                                    size={20}
                                    className={clsx(
                                        "shrink-0 transition-colors duration-300",
                                        isActive ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"
                                    )}
                                />
                                <span className={clsx(
                                    "font-semibold text-sm tracking-tight transition-all duration-300 whitespace-nowrap",
                                    !isSidebarOpen && "opacity-0 invisible w-0",
                                    isActive ? "text-emerald-300" : "text-slate-400 group-hover:text-white"
                                )}>
                                    {item.label}
                                </span>
                                {item.badge && isSidebarOpen && (
                                    <span className={clsx(
                                        "ml-auto text-[10px] font-black uppercase px-2 py-0.5 rounded-md",
                                        isActive
                                            ? "bg-emerald-500/20 text-emerald-300"
                                            : "bg-white/5 text-slate-500"
                                    )}>
                                        {item.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* Bottom Section */}
                <div className="p-4 border-t border-[#1E293B]/50">
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-all border-none cursor-pointer bg-transparent"
                    >
                        {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                        <span className={clsx("text-sm font-medium", !isSidebarOpen && "hidden")}>{t('adminLayout.collapse')}</span>
                    </button>
                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all border-none cursor-pointer bg-transparent mt-1"
                    >
                        <LogOut size={18} />
                        <span className={clsx("text-sm font-medium", !isSidebarOpen && "hidden")}>{t('adminLayout.signOut')}</span>
                    </button>
                </div>
            </aside>

            {/* Mobile Header */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-[#0A1128]/95 backdrop-blur-xl border-b border-[#1E293B]/50 z-40 flex items-center justify-between px-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center">
                        <Shield className="text-white" size={14} />
                    </div>
                    <span className="font-black text-lg tracking-tighter">Traffio <span className="text-emerald-400">Master</span></span>
                </div>
                <button
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    className="w-10 h-10 rounded-xl border border-[#1E293B] flex items-center justify-center text-slate-400 bg-transparent cursor-pointer"
                >
                    {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
            </div>

            {/* Mobile Drawer */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        />
                        <motion.aside
                            initial={{ x: -280 }}
                            animate={{ x: 0 }}
                            exit={{ x: -280 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="lg:hidden fixed left-0 top-0 h-full w-72 bg-[#0A1128] border-r border-[#1E293B]/50 z-50 flex flex-col pt-20"
                        >
                            <nav className="flex-1 px-4 space-y-1">
                                {navItems.map((item) => {
                                    const isActive = activeScreen === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => { onNavigate(item.id); setIsMobileMenuOpen(false); }}
                                            className={clsx(
                                                "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all border-none cursor-pointer",
                                                isActive ? "bg-emerald-500/15" : "bg-transparent hover:bg-white/5"
                                            )}
                                        >
                                            <item.icon size={20} className={isActive ? "text-emerald-400" : "text-slate-500"} />
                                            <span className={clsx("font-semibold text-sm", isActive ? "text-emerald-300" : "text-slate-400")}>
                                                {item.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </nav>

                            {/* Mobile Sign Out */}
                            <div className="p-4 mt-auto border-t border-[#1E293B]/50">
                                <button
                                    onClick={handleSignOut}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all border-none cursor-pointer bg-transparent"
                                >
                                    <LogOut size={20} />
                                    <span className="font-semibold text-sm">{t('adminLayout.signOut')}</span>
                                </button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>

            {/* Main Content */}
            <main
                className={clsx(
                    "min-h-screen transition-all duration-500 pt-20 lg:pt-8 px-4 lg:px-10 pb-10",
                    isSidebarOpen ? "lg:ml-72" : "lg:ml-24"
                )}
            >
                {children}
            </main>
        </div>
    );
};
