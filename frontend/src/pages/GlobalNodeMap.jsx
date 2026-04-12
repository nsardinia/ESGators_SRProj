import { Suspense, lazy, useEffect, useMemo, useState } from "react"
import Button from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { useAuth } from "../components/AuthContext"
import useOwnedNodes from "../hooks/useOwnedNodes"
import { API_BASE_URL } from "../lib/api"
import {
  buildNodesWithLocations,
  readActiveOwnedNodeId,
  writeActiveOwnedNodeId,
} from "../lib/nodeLocations"
import "./GlobalNodeMap.css"

const GlobalNodeMapCanvas = lazy(() => import("../components/GlobalNodeMapCanvas"))

function GlobalNodeMap() {
  const { user } = useAuth()
  const { createdNodes, error: ownedNodesError, loadingNodes, warning: ownedNodesWarning } = useOwnedNodes(user)
  const [sharedNodes, setSharedNodes] = useState([])
  const [sharedNodesError, setSharedNodesError] = useState("")
  const [loadingSharedNodes, setLoadingSharedNodes] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState(() => readActiveOwnedNodeId() || null)

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

  const nodesWithLocations = useMemo(() => {
    return buildNodesWithLocations(mapNodes).nodes
  }, [mapNodes])

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
    if (sortedOwnedNodes.length === 0) {
      if (selectedNodeId) {
        setSelectedNodeId(null)
      }
      writeActiveOwnedNodeId("")
      return
    }

    const selectedOwnedNode = sortedOwnedNodes.find((node) => node.deviceId === selectedNodeId)

    if (selectedNodeId && !selectedOwnedNode) {
      return
    }

    const nextActiveNodeId = selectedOwnedNode?.deviceId || sortedOwnedNodes[0].deviceId

    if (nextActiveNodeId !== selectedNodeId) {
      setSelectedNodeId(nextActiveNodeId)
    }

    writeActiveOwnedNodeId(nextActiveNodeId)
  }, [selectedNodeId, sortedOwnedNodes])

  const focusOwnedNode = (index) => {
    if (sortedOwnedNodes.length === 0) {
      return
    }

    const normalizedIndex = (index + sortedOwnedNodes.length) % sortedOwnedNodes.length
    const node = sortedOwnedNodes[normalizedIndex]

    setSelectedNodeId(node.deviceId)
    writeActiveOwnedNodeId(node.deviceId)
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

            <Suspense fallback={<div className="global-node-map-overlay">Loading map...</div>}>
              <GlobalNodeMapCanvas
                nodes={nodesWithLocations}
                ownedNodes={ownedNodesWithLocations}
                selectedNode={selectedNode}
                user={user}
                isLoading={isLoading}
                onSelectNode={setSelectedNodeId}
                onClearSelection={() => setSelectedNodeId(null)}
              />
            </Suspense>
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
