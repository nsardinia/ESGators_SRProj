/**
 * Splash Page
 * 
 * TODO: Create splash page / marketing page. This will be displayed to the user before they login.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { NavLink } from "react-router-dom"

function SplashPage() {
  return (
    <div className="splash-root">
      <div className="splash-panel">
        <h1>ESGators</h1>
        <p>Pre-Auth Splash Page.</p>
        <NavLink className="nav-button" to="/auth">
          Enter App
        </NavLink>
      </div>
    </div>
  )
}

export default SplashPage
