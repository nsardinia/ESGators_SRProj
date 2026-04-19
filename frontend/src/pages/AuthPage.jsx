/**
 * Login Page with firebase auth.
 * 
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */

import { useEffect, useState } from "react"
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../components/AuthContext"
import { Card, CardContent } from "../components/ui/card"
import Button from "../components/ui/button"
import Input from "../components/ui/input"
import { API_BASE_URL } from "../lib/api"
import { auth } from "../lib/firebase-auth"
import { isFirebaseConfigured, notifyFirebaseConfigError } from "../lib/firebase-core"

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
    return <div className="grid min-h-screen place-items-center text-[var(--muted)]">Loading session...</div>
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
    <div
      className="flex min-h-screen items-center justify-center px-6 py-6"
      style={{
        background:
          "radial-gradient(circle at 85% 0%, rgba(62, 207, 142, 0.18), transparent 30%), radial-gradient(circle at 0% 40%, rgba(58, 130, 246, 0.15), transparent 35%), var(--bg)",
      }}
    >
      <Card className="w-full max-w-[460px] border-[var(--border)] bg-[var(--bg-elevated)] shadow-[0_20px_44px_rgba(0,0,0,0.44)]">
        <CardContent className="p-6">
          <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Authentication</p>
          <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">
            {mode === "login" ? "Sign in to ESGators" : "Create your account"}
          </h1>
          <p className="mb-[18px] text-base font-medium text-[var(--muted)]">
          {mode === "login"
            ? "Use your Firebase Auth credentials to continue to the dashboard."
            : "Create a new user with Firebase Auth Email/Password provider."}
          </p>

          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
                <span>Name</span>
                <Input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jane Developer"
                required
                />
              </label>
            )}

            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Email</span>
              <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              />
            </label>

            <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
              <span>Password</span>
              <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              minLength={6}
              required
              />
            </label>

            {error && <p className="m-0 text-[0.86rem] text-[#fca5a5]">{error}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Please wait..."
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-3 border-0 bg-transparent p-0 text-left text-[#c8d5ea] transition-colors hover:text-[var(--text)]"
            onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

export default AuthPage
