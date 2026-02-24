import { useState } from "react"
import { signOut } from "firebase/auth"
import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { auth } from "../lib/firebase"

function AppShell() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const { user } = useAuth()
  const userName = user?.displayName || user?.email || "there"
  const avatarInitial = (user?.displayName || user?.email || "U").charAt(0).toUpperCase()

  return (
    <div className="workspace-root">
      <div
        className="sidebar-hover-zone"
        onMouseEnter={() => setSidebarExpanded(true)}
        aria-hidden="true"
      />
      <aside
        className={`workspace-sidebar ${sidebarExpanded ? "expanded" : "collapsed"}`}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        <div className="sidebar-header">Hi, {userName}</div>
        <nav className="sidebar-nav">
          <NavLink to="/app/dashboard" className={({ isActive }) => `sidebar-item ${isActive ? "active" : ""}`}>
            <span className="sidebar-icon">D</span>
            <span className="sidebar-label">Dashboard</span>
          </NavLink>
          <NavLink to="/app/node-map" className={({ isActive }) => `sidebar-item ${isActive ? "active" : ""}`}>
            <span className="sidebar-icon">N</span>
            <span className="sidebar-label">Node Map</span>
          </NavLink>
          <button type="button" className="sidebar-item">
            <span className="sidebar-icon">M</span>
            <span className="sidebar-label">ML Features</span>
          </button>
          <button type="button" className="sidebar-item">
            <span className="sidebar-icon">C</span>
            <span className="sidebar-label">Configuration</span>
          </button>
          <button type="button" className="sidebar-item">
            <span className="sidebar-icon">P</span>
            <span className="sidebar-label">Privacy</span>
          </button>
          <button type="button" className="sidebar-item">
            <span className="sidebar-icon">U</span>
            <span className="sidebar-label">Community</span>
          </button>
        </nav>
        <button type="button" className="sidebar-settings" onClick={() => signOut(auth)}>
          <span className="sidebar-icon">S</span>
          <span className="sidebar-label">Sign Out</span>
        </button>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <NavLink className="profile-chip" to="/profile/account" aria-label="Open profile settings">
            {avatarInitial}
          </NavLink>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

export default AppShell
