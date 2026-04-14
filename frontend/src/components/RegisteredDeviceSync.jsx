import { useEffect } from "react"
import { get, ref } from "firebase/database"
import { API_BASE_URL, BACKEND_API_BASE_URL, MWBE_API_BASE_URL, getAuthHeaders } from "../lib/api"
import { useAuth } from "./AuthContext"
import { database } from "../lib/firebase-database"
import { createSampleFingerprint, normalizeFirebaseDevicePayload } from "../lib/firebase-telemetry"

const DEVICE_POLLING_INTERVAL_MS = 5000

function RegisteredDeviceSync() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.uid || !user.email) {
      return undefined
    }

    let ignore = false
    let syncInFlight = false
    let ownerFirebaseUid = ""
    const uploadedFingerprintsBySeries = {}

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

      return String(ownerPayload.user.firebase_uid || "").trim()
    }

    const loadOwnedDevices = async () => {
      const response = await fetch(`${API_BASE_URL}/devices/owned`, {
        headers: await getAuthHeaders(user),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          payload.message ||
          `Failed to load nodes from ${API_BASE_URL}/devices/owned`
        )
      }

      return Array.isArray(payload.devices) ? payload.devices : []
    }

    const syncRegisteredDevices = async () => {
      if (ignore || syncInFlight || !database) {
        return
      }

      syncInFlight = true

      try {
        if (!ownerFirebaseUid) {
          ownerFirebaseUid = await ensureOwner()
        }

        const devices = await loadOwnedDevices()

        if (devices.length === 0) {
          return
        }

        const snapshots = await Promise.all(
          devices.map((device) =>
            get(ref(database, `users/${ownerFirebaseUid}/devices/${device.deviceId}`))
          )
        )

        const samples = snapshots.flatMap((snapshot, index) => {
          const device = devices[index]

          return normalizeFirebaseDevicePayload(
            device?.deviceId,
            snapshot.val()
          ).map((sample) => ({
            ...sample,
            owner_uid: ownerFirebaseUid,
            owner_email: user.email,
            device_name: device?.name || sample.sensor_id,
          }))
        })

        const changedSamples = samples.filter((sample) => {
          const seriesKey = `${sample.sensor_id}:${sample.metric_type}:firebase-rtdb`
          const fingerprint = createSampleFingerprint(sample)

          if (uploadedFingerprintsBySeries[seriesKey] === fingerprint) {
            return false
          }

          uploadedFingerprintsBySeries[seriesKey] = fingerprint
          return true
        })

        if (changedSamples.length === 0) {
          return
        }

        const response = await fetch(`${BACKEND_API_BASE_URL}/iot/data/batch`, {
          method: "POST",
          headers: await getAuthHeaders(user, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            source: "firebase-rtdb",
            samples: changedSamples,
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
