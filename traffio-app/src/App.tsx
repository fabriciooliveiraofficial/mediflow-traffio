import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { DashboardLayout } from './layouts/DashboardLayout'
import { Dashboard } from './pages/Dashboard'
import { AgendaMestra } from './pages/AgendaMestra'
import { CrmLeads } from './pages/CrmLeads'
import { FinancialDashboard } from './pages/FinancialDashboard'
import { PatientDetails } from './pages/PatientDetails'
import { Settings } from './pages/Settings'
import { ReceptionDashboard } from './pages/ReceptionDashboard'
import { AdminWhatsApp } from './pages/AdminWhatsApp'
import { CommunicationsHub } from './pages/CommunicationsHub'
import { Professionals } from './pages/admin/Professionals'
import { Services } from './pages/admin/Services'
import { OdontologyHub } from './pages/OdontologyHub'
import { NutritionHub } from './pages/NutritionHub'
import { Intelligence } from './pages/Intelligence'
import { HumanInboxPage } from './pages/HumanInboxPage'
import { FollowUpBoard } from './pages/FollowUpBoard'
import { NotificationsPage } from './pages/NotificationsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { BillingPage } from './pages/BillingPage'
import { PagarmeCallback } from './pages/PagarmeCallback'
import { WaitingRoom } from './pages/patient/WaitingRoom'
import { PreCheckin } from './pages/patient/PreCheckin'
import { MedicalRecordsHub } from './pages/MedicalRecordsHub'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegisterPaymentPage } from './pages/RegisterPaymentPage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LinkRedirectPage } from './pages/LinkRedirectPage'
import { MasterProtectedRoute } from './components/MasterProtectedRoute'
import { AuthRedirector } from './components/AuthRedirector'
import { SubscriptionGuard } from './components/billing/SubscriptionGuard'
import { MasterApp } from './pages/master/MasterApp'
import { ToastProvider } from './contexts/ToastContext'
import { TenantProvider } from './contexts/TenantContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
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
  const [activeScreen, setActiveScreen] = useState('dashboard')
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)

  // REDIRECT GUARD REMOVED - Handled by AuthRedirector

  const handlePatientSelect = (id: string) => {
    setSelectedPatientId(id)
    setActiveScreen('patient-details')
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'dashboard': return <Dashboard key="dashboard" onNavigate={setActiveScreen} />
      case 'agenda': return <AgendaMestra key="agenda" />
      case 'leads': return <CrmLeads key="leads" onSelectPatient={handlePatientSelect} />
      case 'analytics': return <FinancialDashboard key="analytics" />
      case 'intelligence': return <Intelligence key="intelligence" />
      case 'settings': return <Settings key="settings" />
      case 'reception': return <ReceptionDashboard key="reception" />
      case 'inbox': return <HumanInboxPage key="inbox" />
      case 'followup': return <FollowUpBoard key="followup" />
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
      default: return <Dashboard key="dashboard" />
    }
  }

  return (
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
            {renderScreen()}
          </motion.div>
        </AnimatePresence>
      </SubscriptionGuard>
    </DashboardLayout>
  )
}

// Local MasterApp removed in favor of src/pages/master/MasterApp.tsx

// Inner router that has access to AuthContext
function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return null;

  return (
    <TenantProvider>
      <ToastProvider>
        <NotificationProvider>
          <AuthRedirector />
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

            {/* Public Patient Routes */}
            <Route path="/waiting-room" element={<WaitingRoom />} />
            <Route path="/checkin" element={<PreCheckin />} />

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
