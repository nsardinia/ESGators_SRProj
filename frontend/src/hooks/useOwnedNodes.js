import { useCallback, useEffect, useState } from "react"
import { get, ref } from "firebase/database"
import { API_BASE_URL } from "../lib/api"
import { database } from "../lib/firebase"

function mapOwnedDevice(device, previousNode) {
  return {
    id: device.deviceId,
    name: device.name,
    description: device.description,
    status: device.status,
    telemetry: previousNode?.telemetry || null,
    updatedAtMs: previousNode?.updatedAtMs || null,
  }
}

function useOwnedNodes(user) {
  const [loadingNodes, setLoadingNodes] = useState(false)
  const [error, setError] = useState("")
  const [createdNodes, setCreatedNodes] = useState([])

  const syncOwner = useCallback(async () => {
    const ownerResponse = await fetch(`${API_BASE_URL}/users`, {
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
      throw new Error(ownerPayload.message || "Failed to sync node owner")
    }

    return ownerPayload.user
  }, [user])

  const loadOwnedNodes = useCallback(async (ownerFirebaseUid) => {
    setLoadingNodes(true)

    try {
      const params = new URLSearchParams({ ownerUid: ownerFirebaseUid })
      const response = await fetch(`${API_BASE_URL}/devices/owned?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.message || "Failed to load nodes")
      }

      setCreatedNodes((currentNodes) => {
        const previousNodesById = new Map(currentNodes.map((node) => [node.id, node]))

        return (payload.devices || []).map((device) =>
          mapOwnedDevice(device, previousNodesById.get(device.deviceId))
        )
      })
    } catch (requestError) {
      setError(requestError.message || "Failed to load nodes")
    } finally {
      setLoadingNodes(false)
    }
  }, [])

  const reloadNodes = useCallback(async () => {
    if (!user?.uid || !user.email) {
      setCreatedNodes([])
      return
    }

    setError("")
    const owner = await syncOwner()
    await loadOwnedNodes(owner.firebase_uid)
  }, [loadOwnedNodes, syncOwner, user])

  useEffect(() => {
    if (!user?.uid || !user.email) {
      setCreatedNodes([])
      return
    }

    let ignore = false

    const run = async () => {
      try {
        if (!ignore) {
          await reloadNodes()
        }
      } catch (requestError) {
        if (!ignore) {
          setError(requestError.message || "Failed to load nodes")
          setLoadingNodes(false)
        }
      }
    }

    run()

    return () => {
      ignore = true
    }
  }, [reloadNodes, user])

  const createdNodeIds = createdNodes
    .map((node) => node.id)
    .sort()
    .join("|")

  useEffect(() => {
    if (!database || createdNodes.length === 0) {
      return undefined
    }

    let ignore = false

    const loadDeviceData = async () => {
      try {
        const snapshots = await Promise.all(
          createdNodes.map((node) => get(ref(database, `devices/${node.id}`)))
        )

        if (ignore) {
          return
        }

        setCreatedNodes((currentNodes) =>
          currentNodes.map((currentNode) => {
            const snapshotIndex = createdNodes.findIndex((node) => node.id === currentNode.id)

            if (snapshotIndex === -1) {
              return currentNode
            }

            const telemetry = snapshots[snapshotIndex].val()

            return {
              ...currentNode,
              telemetry,
              status: telemetry?.latest?.status || currentNode.status,
              updatedAtMs:
                typeof telemetry?.latest?.updatedAtMs === "number"
                  ? telemetry.latest.updatedAtMs
                  : null,
            }
          })
        )
      } catch {
        if (!ignore) {
          setError("Failed to load node data from Firebase")
        }
      }
    }

    loadDeviceData()

    return () => {
      ignore = true
    }
  }, [createdNodeIds])

  return {
    createdNodes,
    error,
    loadingNodes,
    setCreatedNodes,
    setError,
    syncOwner,
    reloadNodes,
  }
}

export default useOwnedNodes
