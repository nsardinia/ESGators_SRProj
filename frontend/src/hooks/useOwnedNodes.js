import { useCallback, useEffect, useState } from "react"
import { onValue, ref } from "firebase/database"
import { API_BASE_URL, MWBE_API_BASE_URL, getAuthHeaders } from "../lib/api"
import { database } from "../lib/firebase-database"

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

function collectUpdatedAtValues(value, acc = []) {
  if (!value || typeof value !== "object") {
    return acc
  }

  if (typeof value.updatedAtMs === "number") {
    acc.push(value.updatedAtMs)
  }

  if (typeof value.eventAtMs === "number") {
    acc.push(value.eventAtMs)
  }

  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") {
      collectUpdatedAtValues(child, acc)
    }
  })

  return acc
}

function deriveNodeStatus(telemetry, fallbackStatus) {
  return (
    telemetry?.latest?.status ||
    telemetry?.readings?.latest?.status ||
    telemetry?.readings?.status ||
    telemetry?.gatewayReadings?.latest?.status ||
    fallbackStatus
  )
}

function deriveUpdatedAtMs(telemetry) {
  const values = collectUpdatedAtValues(telemetry)

  if (values.length === 0) {
    return null
  }

  return Math.max(...values)
}

function useOwnedNodes(user) {
  const [loadingNodes, setLoadingNodes] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  const [createdNodes, setCreatedNodes] = useState([])
  const [owner, setOwner] = useState(null)

  const syncOwner = useCallback(async () => {
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

    setOwner(ownerPayload.user)
    return ownerPayload.user
  }, [user])

  const loadOwnedNodes = useCallback(async () => {
    setLoadingNodes(true)

    try {
      const response = await fetch(`${API_BASE_URL}/devices/owned`, {
        headers: await getAuthHeaders(user),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          payload.message ||
          `Failed to load nodes from ${MWBE_API_BASE_URL}/devices/owned`
        )
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
  }, [user])

  const reloadNodes = useCallback(async () => {
    if (!user?.uid || !user.email) {
      setCreatedNodes([])
      setOwner(null)
      return
    }

    setError("")
    await syncOwner()
    await loadOwnedNodes()
  }, [loadOwnedNodes, syncOwner, user])

  useEffect(() => {
    if (!user?.uid || !user.email) {
      setCreatedNodes([])
      setOwner(null)
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
    if (!database || createdNodes.length === 0 || !owner?.firebase_uid) {
      return undefined
    }

    const unsubscribes = createdNodes.map((node) =>
      onValue(
        ref(database, `users/${owner.firebase_uid}/devices/${node.id}`),
        (snapshot) => {
          const telemetry = snapshot.val()

          setCreatedNodes((currentNodes) =>
            currentNodes.map((currentNode) => {
              if (currentNode.id !== node.id) {
                return currentNode
              }

              return {
                ...currentNode,
                telemetry,
                status: deriveNodeStatus(telemetry, currentNode.status),
                updatedAtMs: deriveUpdatedAtMs(telemetry),
              }
            })
          )
        },
        () => {
          setError("Failed to load node data from Firebase")
        }
      )
    )

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [createdNodeIds, owner?.firebase_uid])

  return {
    createdNodes,
    error,
    loadingNodes,
    owner,
    setCreatedNodes,
    setError,
    syncOwner,
    reloadNodes,
  }
}

export default useOwnedNodes
