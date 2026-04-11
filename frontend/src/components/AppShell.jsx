/**
 * Shell for user dashboard. Wraps content with sidebar navigation tools for extensibility.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useState } from "react"
import { signOut } from "firebase/auth"
import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../components/AuthContext"
import RegisteredDeviceSync from "./RegisteredDeviceSync"
import { auth } from "../lib/firebase-auth"
import { cn } from "../lib/utils"

function AppShell() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const { user } = useAuth()
  const userName = user?.displayName || user?.email || "there"
  const avatarInitial = (user?.displayName || user?.email || "U").charAt(0).toUpperCase()

  return (
    <div
      className="relative flex h-screen overflow-hidden text-[var(--text)]"
      style={{
        background: "radial-gradient(circle at 90% -10%, rgba(62, 207, 142, 0.08), transparent 30%), var(--bg)",
      }}
    >
      <div
        className="fixed inset-y-0 left-0 z-20 w-[14px] max-[900px]:hidden"
        onMouseEnter={() => setSidebarExpanded(true)}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "relative z-30 flex h-screen flex-col justify-between overflow-hidden border-r border-[var(--border)] bg-[rgba(11,14,20,0.92)] backdrop-blur-[4px] transition-[width,padding] duration-200 max-[900px]:w-[232px] max-[900px]:px-[10px] max-[900px]:py-[14px]",
          sidebarExpanded ? "w-[232px] px-[10px] py-[14px]" : "w-[76px] px-[8px] py-[14px]"
        )}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        <div className={cn("mb-5 mt-2 truncate px-[10px] text-[0.9rem] font-semibold text-[var(--muted)] transition-opacity max-[900px]:opacity-100", !sidebarExpanded && "opacity-0")}>
          Hi, {userName}
        </div>
        <nav className="flex flex-col gap-2">
          <NavLink
            to="/app/dashboard"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.95rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
              D
            </span>
            <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
              Dashboard
            </span>
          </NavLink>
          <NavLink
            to="/app/node-map"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.95rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
              Y
            </span>
            <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
             Your Devices
            </span>
          </NavLink>
          <NavLink
            to="/app/global-node-map"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.95rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
              G
            </span>
            <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
              Global Map
            </span>
          </NavLink>
          <NavLink
            to="/app/configuration"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.95rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
              C
            </span>
            <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
              Configuration
            </span>
          </NavLink>
          <NavLink
            to="/app/hardware"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.95rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
              H
            </span>
            <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
              Hardware
            </span>
          </NavLink>
        </nav>
        <button
          type="button"
          className="mb-2 flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[0.9rem] text-[var(--muted)] transition-colors hover:bg-[#1b2434] hover:text-[var(--text)]"
          onClick={() => signOut(auth)}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-[#2d3749] bg-[#121927] text-[0.75rem] font-bold text-[#b6c2d4]">
            S
          </span>
          <span className={cn("whitespace-nowrap transition-all max-[900px]:pointer-events-auto max-[900px]:translate-x-0 max-[900px]:opacity-100", !sidebarExpanded && "pointer-events-none -translate-x-1 opacity-0")}>
            Sign Out
          </span>
        </button>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[38px] py-[26px] max-[900px]:p-[18px]">
        <RegisteredDeviceSync />
        <header className="pointer-events-none mb-0 flex h-0 items-center justify-end">
          <NavLink
            className="pointer-events-auto fixed right-7 top-6 z-40 flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[#161d2a] text-[0.78rem] font-semibold text-[var(--muted)] no-underline shadow-[0_14px_30px_rgba(0,0,0,0.28)] transition-colors hover:border-[#3a455d] hover:text-[var(--text)] max-[900px]:right-[18px] max-[900px]:top-[18px] max-[900px]:size-9"
            to="/profile/account"
            aria-label="Open profile settings"
          >
            {avatarInitial}
          </NavLink>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

export default AppShell
