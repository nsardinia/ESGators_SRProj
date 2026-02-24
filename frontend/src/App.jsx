import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import AppShell from "./components/AppShell"
import ProfileShell from "./components/ProfileShell"
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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/app" element={<AppShell />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="node-map" element={<NodeMapPage />} />
          <Route index element={<Navigate to="dashboard" replace />} />
        </Route>
        <Route path="/profile" element={<ProfileShell />}>
          <Route path="account" element={<AccountPage />} />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route index element={<Navigate to="account" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
