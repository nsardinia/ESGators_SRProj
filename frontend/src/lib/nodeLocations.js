const NODE_LOCATION_STORAGE_KEY = "esgators-global-node-locations-v3"
const ACTIVE_OWNED_NODE_STORAGE_KEY = "esgators-active-owned-node-id-v1"

const GAINESVILLE_CLUSTER = {
  label: "Gainesville, Florida (Near UF)",
  latitude: 29.6436,
  longitude: -82.3549,
}

const SEOUL_CLUSTER = {
  label: "Seoul, South Korea",
  latitude: 37.5665,
  longitude: 126.978,
}

const SEOUL_OWNER_EMAILS = new Set(["nicholassardinia@ufl.edus", "nicholassardinia@ufl.edu"])

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
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

function hashString(value) {
  return Array.from(String(value || "")).reduce((hash, character) => {
    return ((hash << 5) - hash + character.charCodeAt(0)) >>> 0
  }, 0)
}

function readStoredNodeLocations() {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(NODE_LOCATION_STORAGE_KEY)
    const parsed = JSON.parse(rawValue || "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredNodeLocations(locations) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(NODE_LOCATION_STORAGE_KEY, JSON.stringify(locations))
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

function chooseNodeCluster(ownerEmail) {
  return SEOUL_OWNER_EMAILS.has(String(ownerEmail || "").toLowerCase())
    ? SEOUL_CLUSTER
    : GAINESVILLE_CLUSTER
}

function createStoredLocation(nodeId, cluster) {
  const hash = hashString(nodeId)
  const latitudeOffset = ((hash >> 3) % 240) / 10000 - 0.012
  const longitudeOffset = ((hash >> 11) % 280) / 10000 - 0.014

  return {
    latitude: clamp(cluster.latitude + latitudeOffset, -70, 70),
    longitude: wrapLongitude(cluster.longitude + longitudeOffset),
    label: cluster.label,
  }
}

function getResolvedNodeLocations(nodes, baseLocations = readStoredNodeLocations()) {
  const nextLocations = { ...baseLocations }
  let didChange = false

  nodes.forEach((node) => {
    const nodeId = String(node?.deviceId || node?.id || "").trim()

    if (!nodeId) {
      return
    }

    const cluster = chooseNodeCluster(node?.owner?.email || node?.ownerEmail || "")
    const nextLocation = createStoredLocation(nodeId, cluster)
    const currentLocation = nextLocations[nodeId]

    if (
      !currentLocation ||
      currentLocation.label !== nextLocation.label ||
      currentLocation.latitude !== nextLocation.latitude ||
      currentLocation.longitude !== nextLocation.longitude
    ) {
      nextLocations[nodeId] = nextLocation
      didChange = true
    }
  })

  return {
    locations: nextLocations,
    didChange,
  }
}

function buildNodesWithLocations(nodes, baseLocations = readStoredNodeLocations()) {
  const { locations, didChange } = getResolvedNodeLocations(nodes, baseLocations)

  return {
    locations,
    didChange,
    nodes: nodes
      .map((node) => {
        const nodeId = String(node?.deviceId || node?.id || "").trim()
        const location = locations[nodeId]

        if (!nodeId || !location) {
          return null
        }

        return {
          ...node,
          deviceId: nodeId,
          latitude: location.latitude,
          longitude: location.longitude,
          locationLabel: location.label,
        }
      })
      .filter(Boolean),
  }
}

export {
  ACTIVE_OWNED_NODE_STORAGE_KEY,
  NODE_LOCATION_STORAGE_KEY,
  readActiveOwnedNodeId,
  readStoredNodeLocations,
  writeActiveOwnedNodeId,
  writeStoredNodeLocations,
  getResolvedNodeLocations,
  buildNodesWithLocations,
}
