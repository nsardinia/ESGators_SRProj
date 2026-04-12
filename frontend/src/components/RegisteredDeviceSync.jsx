import { useEffect } from "react"
import { BACKEND_API_BASE_URL, getAuthHeaders } from "../lib/api"
import { useAuth } from "./AuthContext"

const DEVICE_POLLING_INTERVAL_MS = 5000

function RegisteredDeviceSync() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.uid || !user.email) {
      return undefined
    }

    let ignore = false
    let syncInFlight = false

    const syncRegisteredDevices = async () => {
      if (ignore || syncInFlight) {
        return
      }

      syncInFlight = true

      try {
        const response = await fetch(`${BACKEND_API_BASE_URL}/firebase/sync`, {
          method: "POST",
          headers: await getAuthHeaders(user, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            ownerUid: user.uid,
          }),
        })

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}))
          throw new Error(
            errorPayload.detail || errorPayload.error || `HTTP ${response.status}`
          )
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

  return null
}

export default RegisteredDeviceSync
