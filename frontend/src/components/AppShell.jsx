/**
 * Shell for user dashboard. Wraps content with sidebar navigation tools for extensibility.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useState } from "react"
import { signOut } from "firebase/auth"
import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../components/AuthContext"
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
          <NavLink to="/app/configuration" className={({ isActive }) => `sidebar-item ${isActive ? "active" : ""}`}>
            <span className="sidebar-icon">C</span>
            <span className="sidebar-label">Configuration</span>
          </NavLink>
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
