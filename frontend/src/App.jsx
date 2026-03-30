/**
 * Application routing for the IoT environmental monitoring and ESG scoring dashboard
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

import { Suspense, lazy } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AuthProvider } from "./components/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"

const SplashPage = lazy(() => import("./pages/SplashPage"))
const AuthPage = lazy(() => import("./pages/AuthPage"))
const AppShell = lazy(() => import("./components/AppShell"))
const DashboardPage = lazy(() => import("./pages/DashboardPage"))
const NodeMapPage = lazy(() => import("./pages/NodeMapPage"))
const GlobalNodeMap = lazy(() => import("./pages/GlobalNodeMap"))
const ConfigurationPage = lazy(() => import("./pages/ConfigurationPage"))
const ProfileShell = lazy(() => import("./components/ProfileShell"))
const AccountPage = lazy(() => import("./pages/profile/AccountPage"))
const PreferencesPage = lazy(() => import("./pages/profile/PreferencesPage"))
const BillingPage = lazy(() => import("./pages/profile/BillingPage"))
const SecurityPage = lazy(() => import("./pages/profile/SecurityPage"))
const HardwarePage = lazy(() => import("./pages/HardwarePage"))

function RouteLoader() {
  return (
    <div
      className="grid min-h-screen place-items-center px-6"
      style={{
        background:
          "radial-gradient(circle at 85% 0%, rgba(62, 207, 142, 0.18), transparent 30%), radial-gradient(circle at 0% 40%, rgba(58, 130, 246, 0.15), transparent 35%), var(--bg)",
      }}
    >
      <div className="min-w-[min(320px,100%)] rounded-[14px] border border-[var(--border)] bg-[rgba(16,20,28,0.92)] px-[22px] py-[18px] text-center text-[var(--muted)] shadow-[0_20px_44px_rgba(0,0,0,0.34)]">
        Loading page...
      </div>
    </div>
  )
}

function LazyRoute({ children }) {
  return (
    <Suspense fallback={<RouteLoader />}>
      {children}
    </Suspense>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/app"
            element={(
              <ProtectedRoute>
                <LazyRoute>
                  <AppShell />
                </LazyRoute>
              </ProtectedRoute>
            )}
          >
            <Route path="dashboard" element={<LazyRoute><DashboardPage /></LazyRoute>} />
            <Route path="node-map" element={<LazyRoute><NodeMapPage /></LazyRoute>} />
            <Route path="global-node-map" element={<LazyRoute><GlobalNodeMap /></LazyRoute>} />
            <Route path="hardware" element={<LazyRoute><HardwarePage /></LazyRoute>} />
            <Route path="configuration" element={<LazyRoute><ConfigurationPage /></LazyRoute>} />
            <Route index element={<Navigate to="dashboard" replace />} />
          </Route>
          <Route
            path="/profile"
            element={(
              <ProtectedRoute>
                <LazyRoute>
                  <ProfileShell />
                </LazyRoute>
              </ProtectedRoute>
            )}
          >
            <Route path="account" element={<LazyRoute><AccountPage /></LazyRoute>} />
            <Route path="preferences" element={<LazyRoute><PreferencesPage /></LazyRoute>} />
            <Route path="billing" element={<LazyRoute><BillingPage /></LazyRoute>} />
            <Route path="security" element={<LazyRoute><SecurityPage /></LazyRoute>} />
            <Route index element={<Navigate to="account" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
