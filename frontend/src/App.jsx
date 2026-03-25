/**
 * Application routing for the IoT environmental monitoring and ESG scoring dashboard
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

import { Suspense, lazy } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AuthProvider } from "./components/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"
import "./App.css"

const SplashPage = lazy(() => import("./pages/SplashPage"))
const AuthPage = lazy(() => import("./pages/AuthPage"))
const AppShell = lazy(() => import("./components/AppShell"))
const DashboardPage = lazy(() => import("./pages/DashboardPage"))
const NodeMapPage = lazy(() => import("./pages/NodeMapPage"))
const ConfigurationPage = lazy(() => import("./pages/ConfigurationPage"))
const ProfileShell = lazy(() => import("./components/ProfileShell"))
const AccountPage = lazy(() => import("./pages/profile/AccountPage"))
const PreferencesPage = lazy(() => import("./pages/profile/PreferencesPage"))
const BillingPage = lazy(() => import("./pages/profile/BillingPage"))
const SecurityPage = lazy(() => import("./pages/profile/SecurityPage"))

function RouteLoader() {
  return (
    <div className="route-loading-shell">
      <div className="route-loading-card">Loading page...</div>
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
          <Route path="/dashboard" element={<DashboardPage />} />
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
