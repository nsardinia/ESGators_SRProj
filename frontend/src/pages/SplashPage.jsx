import { NavLink } from "react-router-dom"

function SplashPage() {
  return (
    <div className="splash-root">
      <div className="splash-panel">
        <h1>ESGators</h1>
        <p>Pre-auth splash space for marketing content, product highlights, and onboarding.</p>
        <div className="splash-actions">
          <NavLink className="nav-button" to="/auth">
            Enter App
          </NavLink>
          <NavLink className="nav-button" to="/dashboard">
            Dashboard
          </NavLink>
        </div>
      </div>
    </div>
  )
}

export default SplashPage
