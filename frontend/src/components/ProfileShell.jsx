/**
 * Shell for user profile (seperate from dashboard). Wraps content with sidebar navigation tools for extensibility.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { signOut } from "firebase/auth"
import { NavLink, Outlet } from "react-router-dom"
import { auth } from "../lib/firebase-auth"
import Button from "./ui/button"
import { cn } from "../lib/utils"

function ProfileShell() {
  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "radial-gradient(circle at 90% 0%, rgba(62, 207, 142, 0.08), transparent 28%), var(--bg)",
      }}
    >
      <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[rgba(11,14,20,0.9)] px-3 py-4 max-[900px]:w-[220px] max-[900px]:px-[9px] max-[900px]:py-[14px]">
        <div className="mb-3 text-[1.1rem] font-bold max-[900px]:mb-[14px] max-[900px]:text-[1rem]">ESGators</div>
        <p className="mb-[10px] ml-2 text-[0.75rem] uppercase tracking-[0.08em] text-[var(--muted)]">Settings</p>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-3">
          <NavLink
            to="/profile/account"
            className={({ isActive }) =>
              cn(
                "rounded-[10px] px-[10px] py-2 text-[0.9rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)] max-[900px]:px-[9px] max-[900px]:py-[7px] max-[900px]:text-[0.84rem]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            Account
          </NavLink>
          <NavLink
            to="/profile/preferences"
            className={({ isActive }) =>
              cn(
                "rounded-[10px] px-[10px] py-2 text-[0.9rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)] max-[900px]:px-[9px] max-[900px]:py-[7px] max-[900px]:text-[0.84rem]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            Preferences
          </NavLink>
          <NavLink
            to="/profile/billing"
            className={({ isActive }) =>
              cn(
                "rounded-[10px] px-[10px] py-2 text-[0.9rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)] max-[900px]:px-[9px] max-[900px]:py-[7px] max-[900px]:text-[0.84rem]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            Billing
          </NavLink>
          <NavLink
            to="/profile/security"
            className={({ isActive }) =>
              cn(
                "rounded-[10px] px-[10px] py-2 text-[0.9rem] text-[var(--muted)] no-underline transition-colors hover:bg-[#1b2434] hover:text-[var(--text)] max-[900px]:px-[9px] max-[900px]:py-[7px] max-[900px]:text-[0.84rem]",
                isActive && "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.38)]"
              )
            }
          >
            Security
          </NavLink>
        </nav>
        <div className="sticky bottom-0 border-t border-[#20293a] bg-[rgba(11,14,20,0.95)] px-2 pb-1.5 pt-2.5 max-[900px]:px-1.5 max-[900px]:pb-1 max-[900px]:pt-2">
          <NavLink className="mb-2 block text-[0.86rem] text-[#c3cfdf] no-underline transition-colors hover:text-[var(--text)] max-[900px]:text-[0.78rem]" to="/app/dashboard">
            Return to App
          </NavLink>
          <Button type="button" variant="secondary" size="sm" className="w-full justify-start" onClick={() => signOut(auth)}>
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto px-[34px] pb-9 pt-7 max-[900px]:px-[18px] max-[900px]:pb-7 max-[900px]:pt-[18px]">
        <header className="mb-3 flex h-[46px] items-center justify-between">
          <p className="m-0 text-[0.92rem] text-[var(--muted)]">Profile Preferences</p>
          <div className="flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[#161d2a] text-[0.78rem] font-semibold text-[var(--muted)] shadow-[0_14px_30px_rgba(0,0,0,0.28)]">
            N
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

export default ProfileShell
