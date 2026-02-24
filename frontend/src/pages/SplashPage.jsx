import { NavLink } from "react-router-dom"

function SplashPage() {
  return (
    <div className="splash-root">
      <div className="splash-panel">
        <h1>ESGators</h1>
        <p>Pre-auth splash space for marketing content, product highlights, and onboarding.</p>
        <NavLink className="nav-button" to="/app/dashboard">
          Enter App
        </NavLink>
      </div>
    </div>
  )
}

export default SplashPage
