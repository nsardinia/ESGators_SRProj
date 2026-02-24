import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AuthProvider } from "./auth/AuthContext"
import AppShell from "./components/AppShell"
import ProfileShell from "./components/ProfileShell"
import ProtectedRoute from "./components/ProtectedRoute"
import AuthPage from "./pages/AuthPage"
import DashboardPage from "./pages/DashboardPage"
import NodeMapPage from "./pages/NodeMapPage"
import SplashPage from "./pages/SplashPage"
import AccountPage from "./pages/profile/AccountPage"
import BillingPage from "./pages/profile/BillingPage"
import PreferencesPage from "./pages/profile/PreferencesPage"
import SecurityPage from "./pages/profile/SecurityPage"
import "./App.css"

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/app"
            element={(
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            )}
          >
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="node-map" element={<NodeMapPage />} />
            <Route index element={<Navigate to="dashboard" replace />} />
          </Route>
          <Route
            path="/profile"
            element={(
              <ProtectedRoute>
                <ProfileShell />
              </ProtectedRoute>
            )}
          >
            <Route path="account" element={<AccountPage />} />
            <Route path="preferences" element={<PreferencesPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route index element={<Navigate to="account" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
