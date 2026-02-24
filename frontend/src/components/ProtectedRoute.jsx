import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import FirebaseConfigError from "./FirebaseConfigError"
import { isFirebaseConfigured } from "../lib/firebase"

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (!isFirebaseConfigured) {
    return <FirebaseConfigError />
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
