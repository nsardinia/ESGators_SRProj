const NODE_LOCATION_STORAGE_KEY = "esgators-global-node-locations-v4"
const ACTIVE_OWNED_NODE_STORAGE_KEY = "esgators-active-owned-node-id-v1"

const GAINESVILLE_FALLBACK = {
  latitude: 29.6516,
  longitude: -82.3248,
  label: "Unknown location (Gainesville, Florida fallback)",
  isUnknown: true,
}

const SEOUL_FALLBACK = {
  latitude: 37.5665,
  longitude: 126.978,
  label: "Seoul, SK",
  isUnknown: false,
}

const KNOWN_NODE_LOCATION_OVERRIDES = new Map([
  ["seoulsensor1", SEOUL_FALLBACK],
  ["seoulsensor2", SEOUL_FALLBACK],
])

function normalizeCoordinate(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeNodeLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function clampLatitude(latitude) {
  return Math.min(Math.max(latitude, -90), 90)
}

function wrapLongitude(longitude) {
  let nextLongitude = longitude

  while (nextLongitude < -180) {
    nextLongitude += 360
  }

  while (nextLongitude > 180) {
    nextLongitude -= 360
  }

  return nextLongitude
}

function formatCoordinateLabel(latitude, longitude) {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
}

function normalizeStoredLocation(location) {
  if (!location || typeof location !== "object") {
    return null
  }

  const latitude = normalizeCoordinate(location.latitude)
  const longitude = normalizeCoordinate(location.longitude)

  if (latitude === null || longitude === null) {
    return null
  }

  const normalizedLatitude = clampLatitude(latitude)
  const normalizedLongitude = wrapLongitude(longitude)
  const isUnknown = Boolean(location.isUnknown)
  const label = String(location.label || "").trim()

  return {
    latitude: normalizedLatitude,
    longitude: normalizedLongitude,
    label: label || (isUnknown ? GAINESVILLE_FALLBACK.label : formatCoordinateLabel(normalizedLatitude, normalizedLongitude)),
    isUnknown,
  }
}

function readStoredNodeLocations() {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(NODE_LOCATION_STORAGE_KEY)
    const parsed = JSON.parse(rawValue || "{}")

    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([nodeId, location]) => [String(nodeId || "").trim(), normalizeStoredLocation(location)])
        .filter(([nodeId, location]) => nodeId && location)
    )
  } catch {
    return {}
  }
}

function writeStoredNodeLocations(locations) {
  if (typeof window === "undefined") {
    return
  }

  const normalizedLocations = Object.fromEntries(
    Object.entries(locations || {})
      .map(([nodeId, location]) => [String(nodeId || "").trim(), normalizeStoredLocation(location)])
      .filter(([nodeId, location]) => nodeId && location)
  )

  window.localStorage.setItem(NODE_LOCATION_STORAGE_KEY, JSON.stringify(normalizedLocations))
}

function upsertStoredNodeLocation(nodeId, location, baseLocations = readStoredNodeLocations()) {
  const normalizedNodeId = String(nodeId || "").trim()
  const normalizedLocation = normalizeStoredLocation(location)

  if (!normalizedNodeId || !normalizedLocation) {
    return baseLocations
  }

  const nextLocations = {
    ...baseLocations,
    [normalizedNodeId]: normalizedLocation,
  }

  writeStoredNodeLocations(nextLocations)
  return nextLocations
}

function readActiveOwnedNodeId() {
  if (typeof window === "undefined") {
    return ""
  }

  return String(window.localStorage.getItem(ACTIVE_OWNED_NODE_STORAGE_KEY) || "").trim()
}

function writeActiveOwnedNodeId(nodeId) {
  if (typeof window === "undefined") {
    return
  }

  const normalizedNodeId = String(nodeId || "").trim()

  if (!normalizedNodeId) {
    window.localStorage.removeItem(ACTIVE_OWNED_NODE_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(ACTIVE_OWNED_NODE_STORAGE_KEY, normalizedNodeId)
}

function getNodeLocation(node, baseLocations = readStoredNodeLocations()) {
  const nodeId = String(node?.deviceId || node?.id || "").trim()

  if (!nodeId) {
    return null
  }

  const embeddedLocation = normalizeStoredLocation({
    latitude: node?.latitude,
    longitude: node?.longitude,
    label: node?.locationLabel,
    isUnknown: node?.isLocationUnknown,
  })

  if (embeddedLocation) {
    return embeddedLocation
  }

  const storedLocation = normalizeStoredLocation(baseLocations[nodeId])

  if (storedLocation) {
    return storedLocation
  }

  const knownLocation = [
    nodeId,
    node?.name,
    node?.label,
    node?.deviceName,
  ]
    .map(normalizeNodeLookupKey)
    .map((key) => KNOWN_NODE_LOCATION_OVERRIDES.get(key))
    .find(Boolean)

  if (knownLocation) {
    return { ...knownLocation }
  }

  return { ...GAINESVILLE_FALLBACK }
}

function buildNodesWithLocations(nodes, baseLocations = readStoredNodeLocations()) {
  return {
    nodes: (nodes || [])
      .map((node) => {
        const nodeId = String(node?.deviceId || node?.id || "").trim()
        const location = getNodeLocation(node, baseLocations)

        if (!nodeId || !location) {
          return null
        }

        return {
          ...node,
          deviceId: nodeId,
          latitude: location.latitude,
          longitude: location.longitude,
          locationLabel: location.label,
          isLocationUnknown: location.isUnknown,
        }
      })
      .filter(Boolean),
  }
}

export {
  ACTIVE_OWNED_NODE_STORAGE_KEY,
  GAINESVILLE_FALLBACK,
  NODE_LOCATION_STORAGE_KEY,
  formatCoordinateLabel,
  getNodeLocation,
  normalizeStoredLocation,
  readActiveOwnedNodeId,
  readStoredNodeLocations,
  upsertStoredNodeLocation,
  writeActiveOwnedNodeId,
  writeStoredNodeLocations,
  buildNodesWithLocations,
}
