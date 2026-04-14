import { useCallback, useEffect, useState } from "react"
import { onValue, ref } from "firebase/database"
import { API_BASE_URL, MWBE_API_BASE_URL, getAuthHeaders } from "../lib/api"
import { database } from "../lib/firebase-database"

const TIMESTAMP_FIELD_NAMES = new Set([
  "updatedatms",
  "eventatms",
  "timestampms",
  "recordedatms",
  "createdatms",
  "updatedat",
  "eventat",
  "timestamp",
  "recordedat",
  "createdat",
])

const SENSOR_DEFINITIONS = [
  {
    key: "temperatureC",
    aliases: ["temperaturec", "temperature", "temp"],
  },
  {
    key: "humidityPct",
    aliases: ["humiditypct", "humidity", "humid"],
  },
  {
    key: "no2",
    aliases: ["no2", "nitrogendioxide"],
  },
  {
    key: "soundLevel",
    aliases: ["soundlevel", "sound_level", "sound", "noiselevels", "noiselevel", "noise", "db", "decibel", "raw"],
  },
  {
    key: "particulateMatterLevel",
    aliases: ["particulatematterlevel", "particulate_matter_level", "particulatematter", "particulatematterlevel", "pm", "pm25", "aqi", "airquality"],
  },
]

function mapOwnedDevice(device, previousNode) {
  return {
    id: device.deviceId,
    name: device.name,
    description: device.description,
    status: device.status,
    latitude: device.latitude ?? previousNode?.latitude ?? null,
    longitude: device.longitude ?? previousNode?.longitude ?? null,
    locationLabel: device.locationLabel ?? previousNode?.locationLabel ?? null,
    isLocationUnknown: typeof device.isLocationUnknown === "boolean"
      ? device.isLocationUnknown
      : (previousNode?.isLocationUnknown ?? true),
    telemetry: previousNode?.telemetry || null,
    rawTelemetry: previousNode?.rawTelemetry || null,
    updatedAtMs: previousNode?.updatedAtMs || null,
  }
}

function parseNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return value
    }

    if (value > 1_000_000_000) {
      return value * 1_000
    }
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value)

    if (Number.isFinite(numericValue)) {
      return parseTimestampMs(numericValue)
    }

    const parsedValue = Date.parse(value)

    if (!Number.isNaN(parsedValue)) {
      return parsedValue
    }
  }

  return null
}

function normalizeLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function collectUpdatedAtValues(value, acc = [], seen = new Set()) {
  if (!value || typeof value !== "object") {
    return acc
  }

  if (seen.has(value)) {
    return acc
  }

  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((child) => {
      if (child && typeof child === "object") {
        collectUpdatedAtValues(child, acc, seen)
      }
    })

    return acc
  }

  Object.entries(value).forEach(([key, child]) => {
    if (TIMESTAMP_FIELD_NAMES.has(normalizeLookupKey(key))) {
      const parsedTimestamp = parseTimestampMs(child)

      if (parsedTimestamp !== null) {
        acc.push(parsedTimestamp)
      }
    }

    if (child && typeof child === "object") {
      collectUpdatedAtValues(child, acc, seen)
    }
  })

  return acc
}

function pickFieldValue(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue
    }

    for (const key of keys) {
      const value = source[key]

      if (value !== undefined && value !== null && value !== "") {
        return value
      }
    }
  }

  return null
}

function collectLeafValues(value, path = [], acc = [], seen = new Set()) {
  if (!value || typeof value !== "object") {
    return acc
  }

  if (seen.has(value)) {
    return acc
  }

  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      collectLeafValues(child, path.concat(String(index)), acc, seen)
    })

    return acc
  }

  Object.entries(value).forEach(([key, child]) => {
    const nextPath = path.concat(key)
    const numericValue = parseNumericValue(child)

    if (numericValue !== null) {
      acc.push({
        key,
        normalizedKey: normalizeLookupKey(key),
        normalizedPath: nextPath.map(normalizeLookupKey),
        value: numericValue,
      })
      return
    }

    collectLeafValues(child, nextPath, acc, seen)
  })

  return acc
}

function scoreCandidate(candidate, aliases, preferredParents = []) {
  let score = 0

  aliases.forEach((alias) => {
    if (candidate.normalizedKey === alias) {
      score = Math.max(score, 100)
    }

    if (candidate.normalizedPath.includes(alias)) {
      score = Math.max(score, 80)
    }

    if (candidate.normalizedKey.includes(alias) || alias.includes(candidate.normalizedKey)) {
      score = Math.max(score, 60)
    }
  })

  preferredParents.forEach((parentAlias) => {
    if (candidate.normalizedPath.includes(parentAlias)) {
      score += 10
    }
  })

  return score
}

function pickSensorValue(payload, aliases, preferredParents = []) {
  const candidates = collectLeafValues(payload)
  let bestScore = 0
  let bestValue = null

  candidates.forEach((candidate) => {
    const score = scoreCandidate(candidate, aliases, preferredParents)

    if (score > bestScore) {
      bestScore = score
      bestValue = candidate.value
    }
  })

  return bestValue
}

function normalizeNodeTelemetry(telemetry) {
  if (!telemetry || typeof telemetry !== "object") {
    return null
  }

  const normalizedTelemetry = {
    ...telemetry,
    temperatureC: pickSensorValue(telemetry, SENSOR_DEFINITIONS[0].aliases, ["sht30", "latest"]),
    humidityPct: pickSensorValue(telemetry, SENSOR_DEFINITIONS[1].aliases, ["sht30", "latest"]),
    no2: pickSensorValue(telemetry, SENSOR_DEFINITIONS[2].aliases, ["no2", "latest"]),
    soundLevel: pickSensorValue(telemetry, SENSOR_DEFINITIONS[3].aliases, ["sound", "latest"]),
    particulateMatterLevel: pickSensorValue(telemetry, SENSOR_DEFINITIONS[4].aliases, ["pms5003", "latest"]),
    status: pickFieldValue(
      [
        telemetry,
        telemetry.latest,
        telemetry.readings,
        telemetry.readings?.latest,
        telemetry.telemetry,
        telemetry.telemetry?.readings,
        telemetry.telemetry?.readings?.latest,
        telemetry.gatewayReadings,
        telemetry.gatewayReadings?.latest,
      ],
      ["status"]
    ),
  }

  const derivedUpdatedAtMs = deriveUpdatedAtMs(telemetry)
  normalizedTelemetry.updatedAtMs = derivedUpdatedAtMs

  return normalizedTelemetry
}

function deriveNodeStatus(telemetry, fallbackStatus) {
  return (
    telemetry?.status ||
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
      setWarning("")
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
      setWarning("")
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
      setWarning("")
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
          const rawTelemetry = snapshot.val()
          const telemetry = normalizeNodeTelemetry(rawTelemetry)

          setWarning("")

          setCreatedNodes((currentNodes) =>
            currentNodes.map((currentNode) => {
              if (currentNode.id !== node.id) {
                return currentNode
              }

              return {
                ...currentNode,
                rawTelemetry,
                telemetry,
                status: deriveNodeStatus(telemetry, currentNode.status),
                updatedAtMs: telemetry?.updatedAtMs ?? null,
              }
            })
          )
        },
        () => {
          setWarning("Live telemetry is unavailable right now.")
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
    warning,
    syncOwner,
    reloadNodes,
  }
}

export default useOwnedNodes
