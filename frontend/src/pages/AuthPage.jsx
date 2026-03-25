/**
 * Login Page
 * 
 * TODO: build out additional functionality (forgot password, etc)
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

import { useEffect, useState } from "react"
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../components/AuthContext"
import { API_BASE_URL } from "../lib/api"
import { auth, isFirebaseConfigured, notifyFirebaseConfigError } from "../lib/firebase"

function AuthPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const destination = location.state?.from?.pathname ?? "/app/dashboard"

  useEffect(() => {
    notifyFirebaseConfigError()
  }, [])

  if (!isFirebaseConfigured || !auth) {
    return null
  }

  if (loading) {
    return <div className="auth-loading">Loading session...</div>
  }

  if (user) {
    return <Navigate to={destination} replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        const trimmedName = name.trim()

        if (trimmedName) {
          await updateProfile(credential.user, { displayName: trimmedName })
        }

        // User sync: notify backend when a Firebase user registers.
        try {
          await fetch(`${API_BASE_URL}/users`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              name: trimmedName || credential.user.displayName || email.split("@")[0],
              firebaseUid: credential.user.uid,
            }),
          })
        } catch (syncError) {
          console.error("Failed to sync new user to backend:", syncError)
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }

      navigate(destination, { replace: true })
    } catch (authError) {
      setError(authError.message || "Authentication failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-root">
      <section className="auth-panel">
        <p className="page-kicker">Authentication</p>
        <h1 className="page-title">{mode === "login" ? "Sign in to ESGators" : "Create your account"}</h1>
        <p className="page-subtitle">
          {mode === "login"
            ? "Use your Firebase Auth credentials to continue to the dashboard."
            : "Create a new user with Firebase Auth Email/Password provider."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jane Developer"
                required
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              minLength={6}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary-action" disabled={submitting}>
            {submitting
              ? "Please wait..."
              : mode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        <button
          type="button"
          className="auth-mode-switch"
          onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </section>
    </div>
  )
}

export default AuthPage
