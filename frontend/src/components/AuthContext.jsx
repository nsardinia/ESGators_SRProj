/**
 * Context manager for auth. Keeps user logged in during page refresh or new session.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { BACKEND_API_BASE_URL, MWBE_API_BASE_URL } from "../lib/api"
import { auth, isFirebaseConfigured } from "../lib/firebase"

const AuthContext = createContext(null)
const DEVICE_POLLING_INTERVAL_MS = 5000

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false)
      setUser(null)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user?.uid || !user.email) {
      return undefined
    }

    let ignore = false
    let syncInFlight = false
    let ownerFirebaseUid = null

    const ensureOwner = async () => {
      const ownerResponse = await fetch(`${MWBE_API_BASE_URL}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          name: user.displayName?.trim() || user.email.split("@")[0],
          firebaseUid: user.uid,
        }),
      })

      const ownerPayload = await ownerResponse.json().catch(() => ({}))

      if (!ownerResponse.ok || !ownerPayload.user?.firebase_uid) {
        throw new Error(
          ownerPayload.message ||
          `Failed to sync node owner from ${MWBE_API_BASE_URL}/users`
        )
      }

      return ownerPayload.user.firebase_uid
    }

    const loadOwnedDeviceIds = async (ownerFirebaseUid) => {
      const params = new URLSearchParams({ ownerUid: ownerFirebaseUid })
      const response = await fetch(`${MWBE_API_BASE_URL}/devices/owned?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          payload.message ||
          `Failed to load nodes from ${MWBE_API_BASE_URL}/devices/owned`
        )
      }

      return [...new Set(
        (payload.devices || [])
          .map((device) => String(device?.deviceId || "").trim())
          .filter(Boolean)
      )]
    }

    const syncRegisteredDevices = async () => {
      if (ignore || syncInFlight) {
        return
      }

      syncInFlight = true

      try {
        if (!ownerFirebaseUid) {
          ownerFirebaseUid = await ensureOwner()
        }

        const deviceIds = await loadOwnedDeviceIds(ownerFirebaseUid)

        if (deviceIds.length === 0) {
          return
        }

        const syncResults = await Promise.allSettled(
          deviceIds.map(async (deviceId) => {
            const response = await fetch(`${BACKEND_API_BASE_URL}/firebase/sync/${deviceId}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            })

            if (response.ok) {
              return
            }

            const errorPayload = await response.json().catch(() => ({}))
            throw new Error(
              errorPayload.detail || errorPayload.error || `HTTP ${response.status}`
            )
          })
        )

        const failedSync = syncResults.find((result) => result.status === "rejected")
        if (failedSync) {
          throw failedSync.reason
        }
      } catch (error) {
        if (!ignore) {
          console.error("Failed to sync registered Firebase metrics:", error)
        }
      } finally {
        syncInFlight = false
      }
    }

    syncRegisteredDevices()

    const intervalId = window.setInterval(
      syncRegisteredDevices,
      DEVICE_POLLING_INTERVAL_MS
    )

    return () => {
      ignore = true
      window.clearInterval(intervalId)
    }
  }, [user?.displayName, user?.email, user?.uid])

  const value = useMemo(() => ({ user, loading }), [user, loading])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }

  return context
}

export { AuthProvider, useAuth }
