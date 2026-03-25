/**
 * Shell for user profile (seperate from dashboard). Wraps content with sidebar navigation tools for extensibility.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { signOut } from "firebase/auth"
import { NavLink, Outlet } from "react-router-dom"
import { auth } from "../lib/firebase"

function ProfileShell() {
  return (
    <div className="profile-layout">
      <aside className="profile-sidebar">
        <div className="profile-sidebar-brand">ESGators</div>
        <p className="profile-sidebar-kicker">Settings</p>
        <nav className="profile-nav">
          <NavLink to="/profile/account" className={({ isActive }) => `profile-nav-item ${isActive ? "active" : ""}`}>
            Account
          </NavLink>
          <NavLink to="/profile/preferences" className={({ isActive }) => `profile-nav-item ${isActive ? "active" : ""}`}>
            Preferences
          </NavLink>
          <NavLink to="/profile/billing" className={({ isActive }) => `profile-nav-item ${isActive ? "active" : ""}`}>
            Billing
          </NavLink>
          <NavLink to="/profile/security" className={({ isActive }) => `profile-nav-item ${isActive ? "active" : ""}`}>
            Security
          </NavLink>
        </nav>
        <div className="profile-sidebar-footer">
          <NavLink className="profile-return-link" to="/app/dashboard">
            Return to App
          </NavLink>
          <button type="button" className="profile-logout-button" onClick={() => signOut(auth)}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="profile-main">
        <header className="profile-topbar">
          <p className="profile-topbar-title">Profile Preferences</p>
          <div className="profile-chip">N</div>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

export default ProfileShell
