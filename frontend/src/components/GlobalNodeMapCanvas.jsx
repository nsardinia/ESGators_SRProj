import { useEffect, useRef, useState } from "react"
import MapView, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

const MAPTILER_KEY = "1JJeayhUVMAg3qND1WEC"
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`

function formatUpdatedAt(updatedAtMs) {
  if (typeof updatedAtMs !== "number") {
    return "No timestamp yet"
  }

  return new Date(updatedAtMs).toLocaleString()
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

function getPopupPlacement(mapInstance, node) {
  if (!mapInstance || !node) {
    return { anchor: "top", offset: 18 }
  }

  const projected = mapInstance.project([node.longitude, node.latitude])
  const canvas = mapInstance.getCanvas()
  const width = canvas?.clientWidth || 0
  const height = canvas?.clientHeight || 0

  const nearLeftEdge = projected.x < width * 0.24
  const nearRightEdge = projected.x > width * 0.76
  const nearTopEdge = projected.y < height * 0.22
  const nearBottomEdge = projected.y > height * 0.7

  if (nearBottomEdge && !nearRightEdge) {
    return { anchor: "right", offset: 20 }
  }

  if (nearBottomEdge && nearRightEdge) {
    return { anchor: "left", offset: 20 }
  }

  if (nearLeftEdge) {
    return { anchor: "right", offset: 20 }
  }

  if (nearRightEdge) {
    return { anchor: "left", offset: 20 }
  }

  if (nearTopEdge) {
    return { anchor: "bottom", offset: 18 }
  }

  return { anchor: "top", offset: 18 }
}

function GlobalNodeMapCanvas({
  nodes,
  ownedNodes,
  selectedNode,
  user,
  isLoading,
  onSelectNode,
  onClearSelection,
}) {
  const mapRef = useRef(null)
  const hasAutoFramedOwnedNodes = useRef(false)
  const [popupPlacement, setPopupPlacement] = useState({ anchor: "top", offset: 18 })
  const selectedNodeId = selectedNode?.deviceId || null

  useEffect(() => {
    const mapInstance = mapRef.current?.getMap?.()
    if (!mapInstance || !selectedNode) {
      return
    }

    const syncPopupPlacement = () => {
      setPopupPlacement(getPopupPlacement(mapInstance, selectedNode))
    }

    syncPopupPlacement()
    mapInstance.on("move", syncPopupPlacement)
    mapInstance.on("resize", syncPopupPlacement)

    return () => {
      mapInstance.off("move", syncPopupPlacement)
      mapInstance.off("resize", syncPopupPlacement)
    }
  }, [selectedNode])

  useEffect(() => {
    if (!mapRef.current || ownedNodes.length === 0 || hasAutoFramedOwnedNodes.current) {
      return
    }

    const dominantClusterCenter = getClusterCenter(ownedNodes)

    if (!dominantClusterCenter) {
      return
    }

    mapRef.current.flyTo({
      center: [dominantClusterCenter.longitude, dominantClusterCenter.latitude],
      zoom: ownedNodes.length > 1 ? 11.2 : 12.8,
      duration: 1200,
      essential: true,
    })

    hasAutoFramedOwnedNodes.current = true
  }, [ownedNodes])

  useEffect(() => {
    if (!mapRef.current || !selectedNode) {
      return
    }

    // Keep focus behavior tied to intentional selection changes, not telemetry refreshes.
    mapRef.current.flyTo({
      center: [selectedNode.longitude, selectedNode.latitude],
      zoom: 12.8,
      duration: 900,
      essential: true,
    })
  }, [selectedNodeId])

  return (
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

        {nodes.map((node) => (
          <Marker
            key={node.deviceId}
            latitude={node.latitude}
            longitude={node.longitude}
            anchor="bottom"
            onClick={(event) => {
              event.originalEvent.stopPropagation()
              onSelectNode(node.deviceId)
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
            anchor={popupPlacement.anchor}
            maxWidth="220px"
            offset={popupPlacement.offset}
            onClose={onClearSelection}
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
                    <dd>{selectedNode.isLocationUnknown ? `${selectedNode.locationLabel} (unknown)` : selectedNode.locationLabel}</dd>
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
                      <div>
                        <dt>NO2</dt>
                        <dd>{selectedNode.telemetry.no2 ?? "N/A"}</dd>
                      </div>
                      <div>
                        <dt>Sound Level</dt>
                        <dd>{selectedNode.telemetry.soundLevel ?? "N/A"} dB</dd>
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
                    <dd>{selectedNode.isLocationUnknown ? `${selectedNode.locationLabel} (unknown)` : selectedNode.locationLabel}</dd>
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

      {!isLoading && nodes.length === 0 && (
        <div className="global-node-map-overlay">
          No nodes are available yet. Create a node in the Node Map page to place it on the network.
        </div>
      )}
    </div>
  )
}

export default GlobalNodeMapCanvas
