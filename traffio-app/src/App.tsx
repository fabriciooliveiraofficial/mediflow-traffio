import { useState, useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { DashboardLayout } from './layouts/DashboardLayout'
import { PagarmeCallback } from './pages/PagarmeCallback'

// Lazy-loaded patient routes to prevent mobile devices from loading the entire admin bundle
const WaitingRoom = lazy(() => import('./pages/patient/WaitingRoom').then(m => ({ default: m.WaitingRoom })));
const PreCheckin = lazy(() => import('./pages/patient/PreCheckin').then(m => ({ default: m.PreCheckin })));

// Lazy-loaded admin routes
const TodayPage = lazy(() => import('./pages/TodayPage').then(m => ({ default: m.TodayPage })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const AgendaMestra = lazy(() => import('./pages/AgendaMestra').then(m => ({ default: m.AgendaMestra })));
const CrmLeads = lazy(() => import('./pages/CrmLeads').then(m => ({ default: m.CrmLeads })));
const FinancialDashboard = lazy(() => import('./pages/FinancialDashboard').then(m => ({ default: m.FinancialDashboard })));
const PatientDetails = lazy(() => import('./pages/PatientDetails').then(m => ({ default: m.PatientDetails })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const ReceptionDashboard = lazy(() => import('./pages/ReceptionDashboard').then(m => ({ default: m.ReceptionDashboard })));
const AdminWhatsApp = lazy(() => import('./pages/AdminWhatsApp').then(m => ({ default: m.AdminWhatsApp })));
const CommunicationsHub = lazy(() => import('./pages/CommunicationsHub').then(m => ({ default: m.CommunicationsHub })));
const Professionals = lazy(() => import('./pages/admin/Professionals').then(m => ({ default: m.Professionals })));
const Services = lazy(() => import('./pages/admin/Services').then(m => ({ default: m.Services })));
const OdontologyHub = lazy(() => import('./pages/OdontologyHub').then(m => ({ default: m.OdontologyHub })));
const NutritionHub = lazy(() => import('./pages/NutritionHub').then(m => ({ default: m.NutritionHub })));
const Intelligence = lazy(() => import('./pages/Intelligence').then(m => ({ default: m.Intelligence })));
const HumanInboxPage = lazy(() => import('./pages/HumanInboxPage').then(m => ({ default: m.HumanInboxPage })));
const FollowUpBoard = lazy(() => import('./pages/FollowUpBoard').then(m => ({ default: m.FollowUpBoard })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })));
const MedicalRecordsHub = lazy(() => import('./pages/MedicalRecordsHub').then(m => ({ default: m.MedicalRecordsHub })));
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegisterPaymentPage } from './pages/RegisterPaymentPage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LinkRedirectPage } from './pages/LinkRedirectPage'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'
import { MasterProtectedRoute } from './components/MasterProtectedRoute'
import { AuthRedirector } from './components/AuthRedirector'
import { AppUpdatePrompt } from './components/AppUpdatePrompt'
import { SubscriptionGuard } from './components/billing/SubscriptionGuard'
import { MasterApp } from './pages/master/MasterApp'
import { ToastProvider } from './contexts/ToastContext'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { supabase } from './lib/supabase'
import { useSessionGuard } from './hooks/useSessionGuard'
import { useSyncHtmlLang } from './hooks/useLang'
import { SessionKickedModal } from './components/SessionKickedModal'
import './App.css'

import { motion, AnimatePresence } from 'framer-motion'

// --- Patient Portal Imports ---
import { PatientAuthLayout } from './layouts/PatientAuthLayout'
import { PatientPortalLayout } from './layouts/PatientPortalLayout'
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalRegister } from './pages/portal/PortalRegister'
import { PortalDashboard } from './pages/portal/PortalDashboard'
import { PortalBook } from './pages/portal/PortalBook'
import { PortalProfile } from './pages/portal/PortalProfile'

// --- Tenant Application Wrapper (Legacy State Navigation) ---
function TenantApp() {
  const { t } = useTranslation('billing')
  // ?screen=... permite deep-link em fluxos de retorno externo (ex.: onboarding Stripe Connect)
  const [activeScreen, setActiveScreen] = useState(() => new URLSearchParams(window.location.search).get('screen') || 'today')
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const { tenant, refresh } = useTenant()
  const { kicked, deactivateCurrentSession } = useSessionGuard()
  
  const welcome = searchParams.get('welcome')
  const [isPolling, setIsPolling] = useState(!!welcome)

  const handleKickedLogout = async () => {
    await deactivateCurrentSession()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // Polling para aguardar webhook do Stripe atualizar o status/cartão do tenant
  useEffect(() => {
    if (!welcome || !tenant || tenant.card_on_file) {
      if (isPolling) {
        setIsPolling(false)
        // Limpa a query param da URL para evitar loops e re-polling no F5
        const newParams = new URLSearchParams(window.location.search)
        if (newParams.has('welcome')) {
          newParams.delete('welcome')
          setSearchParams(newParams, { replace: true })
        }
      }
      return
    }

    const interval = setInterval(async () => {
      await refresh()
    }, 2000)

    return () => clearInterval(interval)
  }, [welcome, tenant?.card_on_file, refresh, searchParams, setSearchParams, isPolling])

  // REDIRECT GUARD REMOVED - Handled by AuthRedirector

  const handlePatientSelect = (id: string) => {
    setSelectedPatientId(id)
    setActiveScreen('patient-details')
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'today': return <TodayPage key="today" onNavigate={setActiveScreen} />
      case 'dashboard': return <Dashboard key="dashboard" onNavigate={setActiveScreen} />
      case 'agenda': return <AgendaMestra key="agenda" />
      case 'leads': return <CrmLeads key="leads" onSelectPatient={handlePatientSelect} />
      case 'analytics': return <FinancialDashboard key="analytics" />
      case 'intelligence': return <Intelligence key="intelligence" />
      case 'settings': return <Settings key="settings" />
      case 'reception': return <ReceptionDashboard key="reception" />
      case 'inbox': return <HumanInboxPage key="inbox" />
      case 'followup': return <FollowUpBoard key="followup" onNavigate={setActiveScreen} />
      case 'notifications': return <NotificationsPage key="notifications" />
      case 'payments': return <PaymentsPage key="payments" />
      case 'billing': return <BillingPage key="billing" />
      case 'whatsapp': return <AdminWhatsApp key="whatsapp" />
      case 'communications': return <CommunicationsHub key="communications" />
      case 'professionals': return <Professionals key="professionals" />
      case 'services': return <Services key="services" />
      case 'odontology': 
      case 'odontogram':
        return <OdontologyHub key="odontology" activeView={activeScreen} />
      case 'nutrition': 
      case 'nutrition-plan':
        return <NutritionHub key="nutrition" activeView={activeScreen} />
      case 'medical-records':
        return <MedicalRecordsHub key="medical-records" />
      case 'patient-details':
        return selectedPatientId ? (
          <PatientDetails
            key="patient-details"
            patientId={selectedPatientId}
            onBack={() => setActiveScreen('leads')}
          />
        ) : <CrmLeads key="leads-fallback" onSelectPatient={handlePatientSelect} />
      default: return <TodayPage key="today" onNavigate={setActiveScreen} />
    }
  }

  if (isPolling && tenant && !tenant.card_on_file) {
    return (
      <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 text-center">
          <div className="w-20 h-20 bg-brand-primary/10 text-brand-primary rounded-full flex items-center justify-center mx-auto mb-6">
            <Loader2 className="animate-spin text-brand-primary" size={40} />
          </div>
          <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('paymentPolling.title')}</h2>
          <p className="text-sm font-medium text-graphite-500 leading-relaxed">
            {t('paymentPolling.message')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {kicked && <SessionKickedModal onLogout={handleKickedLogout} />}
      <DashboardLayout activeScreen={activeScreen} onNavigate={setActiveScreen}>
      <SubscriptionGuard activeScreen={activeScreen} onNavigate={setActiveScreen}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeScreen}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="h-full"
          >
            <Suspense fallback={
              <div className="flex items-center justify-center h-full min-h-[300px]">
                <Loader2 className="animate-spin text-brand-primary" size={32} />
              </div>
            }>
              {renderScreen()}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </SubscriptionGuard>
    </DashboardLayout>
    </>
  )
}

// Local MasterApp removed in favor of src/pages/master/MasterApp.tsx

// Inner router that has access to AuthContext
function AppRoutes() {
  const { session, loading } = useAuth();
  useSyncHtmlLang();

  if (loading) return null;

  return (
    <TenantProvider>
      <ToastProvider>
        <NotificationProvider>
          <AuthRedirector />
          <AppUpdatePrompt />
          <Routes>
            {/* ... other routes ... */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/register/payment" element={<RegisterPaymentPage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/pagarme-callback" element={<PagarmeCallback />} />
            <Route path="/l/:code" element={<LinkRedirectPage />} />
            <Route path="/privacidade" element={<PrivacyPolicy />} />
            <Route path="/termos" element={<TermsOfService />} />

            {/* Public Patient Routes */}
            <Route path="/waiting-room" element={
              <Suspense fallback={
                <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
                  <Loader2 className="animate-spin text-brand-primary" size={40} />
                </div>
              }>
                <WaitingRoom />
              </Suspense>
            } />
            <Route path="/checkin" element={
              <Suspense fallback={
                <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
                  <Loader2 className="animate-spin text-brand-primary" size={40} />
                </div>
              }>
                <PreCheckin />
              </Suspense>
            } />

            {/* Protected Routes */}
            <Route
              path="/dashboard/*"
              element={session ? <TenantApp /> : <Navigate to="/login" replace />}
            />

            {/* --- Patient Portal Routes (SAAS) --- */}
            <Route path="/portal/:slug">
              {/* Public Auth Routes */}
              <Route element={<PatientAuthLayout />}>
                <Route index element={<Navigate to="login" replace />} />
                <Route path="login" element={<PortalLogin />} />
                <Route path="register" element={<PortalRegister />} />
              </Route>

              {/* Protected Portal Routes */}
              <Route element={<PatientPortalLayout />}>
                <Route path="dashboard" element={<PortalDashboard />} />
                <Route path="book" element={<PortalBook />} />
                <Route path="profile" element={<PortalProfile />} />
              </Route>
            </Route>

            {/* Protected Master Routes */}
            <Route element={<MasterProtectedRoute />}>
              <Route path="/master/*" element={<MasterApp />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NotificationProvider>
      </ToastProvider>
    </TenantProvider>
  )
}

// --- Main App Router ---
function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
