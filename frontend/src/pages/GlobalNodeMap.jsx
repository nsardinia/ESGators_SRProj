import { useEffect, useMemo, useRef, useState } from "react"
import MapView, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import Button from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { useAuth } from "../components/AuthContext"
import useOwnedNodes from "../hooks/useOwnedNodes"
import { API_BASE_URL } from "../lib/api"
import "./GlobalNodeMap.css"

const MAPTILER_KEY = "1JJeayhUVMAg3qND1WEC"
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
const NODE_LOCATION_STORAGE_KEY = "esgators-global-node-locations-v3"

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

function formatUpdatedAt(updatedAtMs) {
  if (typeof updatedAtMs !== "number") {
    return "No timestamp yet"
  }

  return new Date(updatedAtMs).toLocaleString()
}

function hashString(value) {
  return Array.from(String(value || "")).reduce((hash, character) => {
    return ((hash << 5) - hash + character.charCodeAt(0)) >>> 0
  }, 0)
}

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

function getClusterCenter(nodes) {
  if (nodes.length === 0) {
    return null
  }

  const clusters = new Map()

  nodes.forEach((node) => {
    const key = node.locationLabel || "Unknown"
    const existingCluster = clusters.get(key) || {
      count: 0,
      latitudeTotal: 0,
      longitudeTotal: 0,
    }

    existingCluster.count += 1
    existingCluster.latitudeTotal += node.latitude
    existingCluster.longitudeTotal += node.longitude
    clusters.set(key, existingCluster)
  })

  const dominantCluster = Array.from(clusters.values()).sort((left, right) => right.count - left.count)[0]

  return {
    latitude: dominantCluster.latitudeTotal / dominantCluster.count,
    longitude: dominantCluster.longitudeTotal / dominantCluster.count,
  }
}

function GlobalNodeMap() {
  const { user } = useAuth()
  const { createdNodes, error: ownedNodesError, loadingNodes, warning: ownedNodesWarning } = useOwnedNodes(user)
  const mapRef = useRef(null)
  const hasAutoFramedOwnedNodes = useRef(false)
  const [sharedNodes, setSharedNodes] = useState([])
  const [sharedNodesError, setSharedNodesError] = useState("")
  const [loadingSharedNodes, setLoadingSharedNodes] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [storedLocations, setStoredLocations] = useState(() => readStoredNodeLocations())

  useEffect(() => {
    if (!user?.uid || !user.email) {
      setSharedNodes([])
      setSharedNodesError("")
      return undefined
    }

    let ignore = false

    const loadNetworkNodes = async () => {
      setLoadingSharedNodes(true)
      setSharedNodesError("")

      try {
        const response = await fetch(`${API_BASE_URL}/devices/network`)
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload.message || "Failed to load network nodes")
        }

        if (ignore) {
          return
        }

        const nextSharedNodes = (payload.devices || [])
          .filter((node) => node?.owner?.firebaseUid && node.owner.firebaseUid !== user.uid)
          .map((node) => ({
            ...node,
            ownership: "shared",
          }))

        setSharedNodes(nextSharedNodes)
        setSharedNodesError("")
      } catch (requestError) {
        if (!ignore) {
          setSharedNodes([])
          setSharedNodesError(requestError.message || "Failed to load network nodes")
        }
      } finally {
        if (!ignore) {
          setLoadingSharedNodes(false)
        }
      }
    }

    loadNetworkNodes()

    return () => {
      ignore = true
    }
  }, [user])

  const mapNodes = useMemo(() => {
    const ownedMapNodes = createdNodes.map((node) => ({
      ...node,
      deviceId: node.id,
      owner: {
        email: user?.email || "",
        firebaseUid: user?.uid || "",
        name: user?.displayName || user?.email?.split("@")[0] || "You",
      },
      ownership: "owned",
    }))

    return [...ownedMapNodes, ...sharedNodes]
  }, [createdNodes, sharedNodes, user])

  useEffect(() => {
    if (mapNodes.length === 0) {
      return
    }

    setStoredLocations((currentLocations) => {
      let didChange = false
      const nextLocations = { ...currentLocations }
      const seoulNodeIds = new Set(
        mapNodes
          .filter((node) => SEOUL_OWNER_EMAILS.has(String(node.owner?.email || "").toLowerCase()))
          .map((node) => node.deviceId)
          .sort()
          .slice(0, 2)
      )

      mapNodes.forEach((node) => {
        const cluster = seoulNodeIds.has(node.deviceId) ? SEOUL_CLUSTER : GAINESVILLE_CLUSTER
        const nextLocation = createStoredLocation(node.deviceId, cluster)
        const currentLocation = nextLocations[node.deviceId]

        if (
          !currentLocation ||
          currentLocation.label !== nextLocation.label ||
          currentLocation.latitude !== nextLocation.latitude ||
          currentLocation.longitude !== nextLocation.longitude
        ) {
          nextLocations[node.deviceId] = nextLocation
          didChange = true
        }
      })

      if (!didChange) {
        return currentLocations
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(NODE_LOCATION_STORAGE_KEY, JSON.stringify(nextLocations))
      }

      return nextLocations
    })
  }, [mapNodes])

  const nodesWithLocations = useMemo(() => {
    return mapNodes
      .map((node) => {
        const location = storedLocations[node.deviceId]

        if (!location) {
          return null
        }

        return {
          ...node,
          latitude: location.latitude,
          longitude: location.longitude,
          locationLabel: location.label,
        }
      })
      .filter(Boolean)
  }, [mapNodes, storedLocations])

  const selectedNode = nodesWithLocations.find((node) => node.deviceId === selectedNodeId) || null
  const totalNodeCount = nodesWithLocations.length
  const ownedNodeCount = nodesWithLocations.filter((node) => node.ownership === "owned").length
  const sharedNodeCount = nodesWithLocations.filter((node) => node.ownership === "shared").length
  const combinedError = ownedNodesError || sharedNodesError || ownedNodesWarning
  const isLoading = loadingNodes || loadingSharedNodes
  const ownedNodesWithLocations = nodesWithLocations.filter((node) => node.ownership === "owned")
  const sortedOwnedNodes = [...ownedNodesWithLocations].sort((left, right) =>
    String(left.name || left.deviceId).localeCompare(String(right.name || right.deviceId))
  )
  const activeOwnedNodeIndex = sortedOwnedNodes.findIndex((node) => node.deviceId === selectedNodeId)

  useEffect(() => {
    if (!mapRef.current || ownedNodesWithLocations.length === 0 || hasAutoFramedOwnedNodes.current) {
      return
    }

    const dominantClusterCenter = getClusterCenter(ownedNodesWithLocations)

    if (!dominantClusterCenter) {
      return
    }

    mapRef.current.flyTo({
      center: [dominantClusterCenter.longitude, dominantClusterCenter.latitude],
      zoom: ownedNodesWithLocations.length > 1 ? 11.2 : 12.8,
      duration: 1200,
      essential: true,
    })

    hasAutoFramedOwnedNodes.current = true
  }, [ownedNodesWithLocations])

  const focusOwnedNode = (index) => {
    if (!mapRef.current || sortedOwnedNodes.length === 0) {
      return
    }

    const normalizedIndex = (index + sortedOwnedNodes.length) % sortedOwnedNodes.length
    const node = sortedOwnedNodes[normalizedIndex]

    setSelectedNodeId(node.deviceId)
    mapRef.current.flyTo({
      center: [node.longitude, node.latitude],
      zoom: 12.8,
      duration: 900,
      essential: true,
    })
  }

  return (
    <section className="global-node-map-page">
      <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Global Node Map</p>

      <div className="global-node-map-summary">
        <Card>
          <CardContent className="global-node-map-stat">
            <span className="global-node-map-stat-label">Visible nodes</span>
            <strong>{totalNodeCount}</strong>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="global-node-map-stat">
            <span className="global-node-map-stat-label">Your nodes</span>
            <strong>{ownedNodeCount}</strong>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="global-node-map-stat">
            <span className="global-node-map-stat-label">Other users</span>
            <strong>{sharedNodeCount}</strong>
          </CardContent>
        </Card>
      </div>

      <div className="global-node-map-layout">
        <Card className="global-node-map-stage">
          <CardContent className="global-node-map-stage-content">
            <div className="global-node-map-toolbar">
              <div className="global-node-map-legend" aria-label="Map legend">
                <span className="global-node-map-legend-item">
                  <span className="global-node-map-legend-dot global-node-map-legend-dot-owned" />
                  Your node
                </span>
                <span className="global-node-map-legend-item">
                  <span className="global-node-map-legend-dot global-node-map-legend-dot-shared" />
                  Another user's node
                </span>
              </div>
              <div className="global-node-map-toolbar-actions">
                {sortedOwnedNodes.length > 0 && (
                  <div className="global-node-map-cycle-controls" aria-label="Cycle through your node locations">
                    <Button type="button" variant="secondary" size="sm" onClick={() => focusOwnedNode(activeOwnedNodeIndex - 1)}>
                      Prev
                    </Button>
                    <span className="global-node-map-cycle-label">
                      {activeOwnedNodeIndex >= 0 ? activeOwnedNodeIndex + 1 : 1} / {sortedOwnedNodes.length}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => focusOwnedNode(activeOwnedNodeIndex >= 0 ? activeOwnedNodeIndex + 1 : 0)}
                    >
                      Next
                    </Button>
                  </div>
                )}
                <span className="global-node-map-help">Scroll, drag, and use the controls to explore the map.</span>
              </div>
            </div>

            <div className="global-node-map-frame">
              <MapView
                ref={mapRef}
                initialViewState={{ longitude: 12, latitude: 20, zoom: 1.4 }}
                mapStyle={MAP_STYLE}
                minZoom={1}
                maxZoom={19}
                reuseMaps
                dragRotate={false}
                scrollZoom
                style={{ width: "100%", height: "100%" }}
              >
                <NavigationControl position="top-right" showCompass={false} />

                {nodesWithLocations.map((node) => (
                  <Marker
                    key={node.deviceId}
                    latitude={node.latitude}
                    longitude={node.longitude}
                    anchor="bottom"
                    onClick={(event) => {
                      event.originalEvent.stopPropagation()
                      setSelectedNodeId(node.deviceId)
                    }}
                  >
                    <button
                      type="button"
                      className={`global-node-map-marker global-node-map-marker-${node.ownership}`}
                      aria-label={`Open details for ${node.name || node.deviceId}`}
                    >
                      <span className="global-node-map-marker-core" />
                    </button>
                  </Marker>
                ))}

                {selectedNode && (
                  <Popup
                    closeOnClick={false}
                    latitude={selectedNode.latitude}
                    longitude={selectedNode.longitude}
                    maxWidth="180px"
                    offset={18}
                    onClose={() => setSelectedNodeId(null)}
                  >
                    {selectedNode.ownership === "owned" ? (
                      <article className="global-node-map-popup">
                        <p className="global-node-map-popup-eyebrow">Your Node</p>
                        <h2 className="global-node-map-popup-title">{selectedNode.name || "Unnamed Node"}</h2>
                        {selectedNode.description && (
                          <p className="global-node-map-popup-copy">{selectedNode.description}</p>
                        )}
                        <dl className="global-node-map-popup-grid">
                          <div>
                            <dt>Node ID</dt>
                            <dd>{selectedNode.deviceId}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedNode.status || "Unknown"}</dd>
                          </div>
                          <div>
                            <dt>Location</dt>
                            <dd>{selectedNode.locationLabel}</dd>
                          </div>
                          <div>
                            <dt>Last Update</dt>
                            <dd>{formatUpdatedAt(selectedNode.updatedAtMs)}</dd>
                          </div>
                          {selectedNode.telemetry && (
                            <>
                              <div>
                                <dt>Temperature</dt>
                                <dd>{selectedNode.telemetry.temperatureC ?? "N/A"} C</dd>
                              </div>
                              <div>
                                <dt>Humidity</dt>
                                <dd>{selectedNode.telemetry.humidityPct ?? "N/A"}%</dd>
                              </div>
                            </>
                          )}
                        </dl>
                      </article>
                    ) : (
                      <article className="global-node-map-popup">
                        <p className="global-node-map-popup-eyebrow">Network Node</p>
                        <h2 className="global-node-map-popup-title">{selectedNode.name || "Unnamed Node"}</h2>
                        {selectedNode.description && (
                          <p className="global-node-map-popup-copy">{selectedNode.description}</p>
                        )}
                        <dl className="global-node-map-popup-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedNode.status || "Unknown"}</dd>
                          </div>
                          <div>
                            <dt>Location</dt>
                            <dd>{selectedNode.locationLabel}</dd>
                          </div>
                          <div>
                            <dt>Owner</dt>
                            <dd>{selectedNode.owner?.name || "Unknown owner"}</dd>
                          </div>
                          <div>
                            <dt>Email</dt>
                            <dd>{selectedNode.owner?.email || "No email available"}</dd>
                          </div>
                        </dl>
                        <p className="global-node-map-popup-note">
                          Access control is still frontend-only here. Use the email link below to request this node's
                          data from the owner.
                        </p>
                        <a
                          className="global-node-map-request-link"
                          href={`mailto:${selectedNode.owner?.email || ""}?subject=${encodeURIComponent(
                            `ESGators node access request: ${selectedNode.name || selectedNode.deviceId}`
                          )}&body=${encodeURIComponent(
                            `Hello ${selectedNode.owner?.name || ""},\n\nI would like to request access to the data for node ${
                              selectedNode.name || selectedNode.deviceId
                            } (${selectedNode.deviceId}).\n\nRequester: ${user?.email || "ESGators user"}\n\nThanks,`
                          )}`}
                        >
                          Request access by email
                        </a>
                      </article>
                    )}
                  </Popup>
                )}
              </MapView>

              {isLoading && <div className="global-node-map-overlay">Loading network nodes...</div>}

              {!isLoading && nodesWithLocations.length === 0 && (
                <div className="global-node-map-overlay">
                  No nodes are available yet. Create a node in the Node Map page to place it on the network.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {combinedError && (
          <Card>
            <CardContent className="global-node-map-side-panel">
              <p className="global-node-map-side-title">Load warning</p>
              <p className="global-node-map-side-copy">{combinedError}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}

export default GlobalNodeMap
