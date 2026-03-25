/**
 * Protected routes for auth. Note that to access any actual data, the user will need to provide their firebase
 * access token, so even if this is exploted (which is possible as it's client-side code) the exploit will not
 * expose any sensitive or proprietary data.
 * 
 * This component is intended to ensure good-faith users are able to easily navigate our auth system, not to 
 * enforce privacy against bad actors. That is handled by our backend and firebase auth. 
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useEffect } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "../components/AuthContext"
import { isFirebaseConfigured, notifyFirebaseConfigError } from "../lib/firebase"

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  useEffect(() => {
    notifyFirebaseConfigError()
  }, [])

  if (!isFirebaseConfigured) {
    return null
  }

  if (loading) {
    return <div className="auth-loading">Loading session...</div>
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />
  }

  return children
}

export default ProtectedRoute
