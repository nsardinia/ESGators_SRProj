import { useEffect, useRef, useState } from "react"

const NODE_RADIUS = 42
const CANVAS_WIDTH = 760
const CANVAS_HEIGHT = 520
const DRAG_THRESHOLD = 6

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function truncateNodeLabel(name) {
  if (!name) {
    return "Node"
  }

  return name.length > 11 ? `${name.slice(0, 9)}...` : name
}

function buildInitialPosition(index, total, canvasSize = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total || 1)))
  const usableWidth = Math.max(canvasSize.width - NODE_RADIUS * 2, 120)
  const spacingX = Math.max(110, usableWidth / Math.max(columns, 2))
  const spacingY = 130
  const baseX = NODE_RADIUS + Math.min(68, spacingX / 2)
  const baseY = 110

  return {
    x: clamp(baseX + (index % columns) * spacingX, NODE_RADIUS, canvasSize.width - NODE_RADIUS),
    y: clamp(baseY + Math.floor(index / columns) * spacingY, NODE_RADIUS, canvasSize.height - NODE_RADIUS),
  }
}

function formatNodeName(nodeId, nodesById) {
  return nodesById.get(nodeId)?.name || "None"
}

function getNodeRoles(nodeId, gatewayNodeId, backupGatewayNodeId, includedNodeIds) {
  const isGateway = gatewayNodeId === nodeId
  const isBackupGateway = backupGatewayNodeId === nodeId
  const isIncluded = includedNodeIds.includes(nodeId)

  return {
    isBackupGateway,
    isGateway,
    isIncluded,
  }
}

function NodeNetwork({ nodes }) {
  const networkRef = useRef(null)
  const dragStateRef = useRef(null)
  const [nodePositions, setNodePositions] = useState({})
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [gatewayNodeId, setGatewayNodeId] = useState(null)
  const [backupGatewayNodeId, setBackupGatewayNodeId] = useState(null)
  const [includedNodeIds, setIncludedNodeIds] = useState([])
  const [canvasSize, setCanvasSize] = useState({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  })

  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  useEffect(() => {
    if (!networkRef.current) {
      return undefined
    }

    const updateCanvasSize = () => {
      if (!networkRef.current) {
        return
      }

      const bounds = networkRef.current.getBoundingClientRect()
      setCanvasSize({
        width: Math.max(bounds.width, NODE_RADIUS * 2),
        height: Math.max(bounds.height, NODE_RADIUS * 2),
      })
    }

    updateCanvasSize()

    const resizeObserver = new ResizeObserver(() => updateCanvasSize())
    resizeObserver.observe(networkRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    setNodePositions((currentPositions) => {
      const nextPositions = {}

      nodes.forEach((node, index) => {
        const existingPosition = currentPositions[node.id]
        const fallbackPosition = buildInitialPosition(index, nodes.length, canvasSize)

        nextPositions[node.id] = existingPosition
          ? {
              x: clamp(existingPosition.x, NODE_RADIUS, canvasSize.width - NODE_RADIUS),
              y: clamp(existingPosition.y, NODE_RADIUS, canvasSize.height - NODE_RADIUS),
            }
          : fallbackPosition
      })

      return nextPositions
    })

    setSelectedNodeId((currentSelectedNodeId) =>
      nodes.some((node) => node.id === currentSelectedNodeId) ? currentSelectedNodeId : null
    )
    setGatewayNodeId((currentGatewayNodeId) =>
      nodes.some((node) => node.id === currentGatewayNodeId) ? currentGatewayNodeId : null
    )
    setBackupGatewayNodeId((currentBackupGatewayNodeId) =>
      nodes.some((node) => node.id === currentBackupGatewayNodeId) ? currentBackupGatewayNodeId : null
    )
    setIncludedNodeIds((currentIncludedNodeIds) =>
      currentIncludedNodeIds.filter((nodeId) => nodes.some((node) => node.id === nodeId))
    )
  }, [canvasSize.height, canvasSize.width, nodes])

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current

      if (!dragState || !networkRef.current) {
        return
      }

      const bounds = networkRef.current.getBoundingClientRect()

      if (
        Math.abs(event.clientX - dragState.startX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - dragState.startY) > DRAG_THRESHOLD
      ) {
        dragState.hasMoved = true
      }

      const x = clamp(event.clientX - bounds.left - dragState.offsetX, NODE_RADIUS, bounds.width - NODE_RADIUS)
      const y = clamp(event.clientY - bounds.top - dragState.offsetY, NODE_RADIUS, bounds.height - NODE_RADIUS)

      setNodePositions((currentPositions) => ({
        ...currentPositions,
        [dragState.nodeId]: { x, y },
      }))
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [])
  const handlePointerDown = (event, nodeId) => {
    if (!networkRef.current) {
      return
    }

    const bounds = networkRef.current.getBoundingClientRect()
    const position = nodePositions[nodeId]

    dragStateRef.current = {
      hasMoved: false,
      nodeId,
      offsetX: event.clientX - bounds.left - position.x,
      offsetY: event.clientY - bounds.top - position.y,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  const handleNodeClick = (nodeId) => {
    if (dragStateRef.current?.hasMoved) {
      dragStateRef.current = null
      return
    }

    setSelectedNodeId((currentSelectedNodeId) => (currentSelectedNodeId === nodeId ? null : nodeId))
  }

  const toggleNodeIncluded = (nodeId) => {
    setIncludedNodeIds((currentIncludedNodeIds) => {
      const isIncluded = currentIncludedNodeIds.includes(nodeId)

      if (isIncluded) {
        if (gatewayNodeId === nodeId) {
          setGatewayNodeId(null)
        }

        if (backupGatewayNodeId === nodeId) {
          setBackupGatewayNodeId(null)
        }

        return currentIncludedNodeIds.filter((currentNodeId) => currentNodeId !== nodeId)
      }

      return [...currentIncludedNodeIds, nodeId]
    })
  }

  const assignGatewayRole = (role, nodeId) => {
    setIncludedNodeIds((currentIncludedNodeIds) =>
      currentIncludedNodeIds.includes(nodeId) ? currentIncludedNodeIds : [...currentIncludedNodeIds, nodeId]
    )

    if (role === "primary") {
      setGatewayNodeId(nodeId)
      if (backupGatewayNodeId === nodeId) {
        setBackupGatewayNodeId(null)
      }
      return
    }

    setBackupGatewayNodeId(nodeId)
    if (gatewayNodeId === nodeId) {
      setGatewayNodeId(null)
    }
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null

  const handleExportNetwork = () => {
    const radioNetwork = includedNodeIds.reduce((network, nodeId) => {
      const node = nodesById.get(nodeId)

      if (!node) {
        return network
      }

      network[nodeId] = {
        isBackupGateway: backupGatewayNodeId === nodeId,
        isGateway: gatewayNodeId === nodeId,
        name: node.name,
      }

      return network
    }, {})

    const blob = new Blob([JSON.stringify(radioNetwork, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = "radio-network.json"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="node-network-panel">
      <div className="node-search node-network-header">
        <div>
          <span>Node Network</span>
          <p className="node-network-hint">
            Drag nodes to reposition them. Click a node to manage gateway roles and radio-network inclusion.
          </p>
        </div>
        <button
          type="button"
          className="secondary-action node-network-export-button"
          onClick={handleExportNetwork}
          disabled={includedNodeIds.length === 0}
        >
          Export Network JSON
        </button>
      </div>

      <div className="node-network-layout">
        <div className="node-network-shell">
          <div className="node-network-canvas" ref={networkRef}>
            {nodes.length === 0 ? (
              <div className="node-empty-state">Create a node first to start arranging your layout.</div>
            ) : (
              <>
                {nodes.map((node) => {
                  const position = nodePositions[node.id] || buildInitialPosition(0, nodes.length, canvasSize)
                  const isSelected = selectedNodeId === node.id
                  const { isIncluded, isGateway, isBackupGateway } = getNodeRoles(
                    node.id,
                    gatewayNodeId,
                    backupGatewayNodeId,
                    includedNodeIds
                  )
                  const nodeClassName = [
                    "node-network-node",
                    isSelected ? "is-selected" : "",
                    isIncluded ? "is-included" : "",
                    isGateway ? "is-gateway" : "",
                    isBackupGateway ? "is-backup-gateway" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")

                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={nodeClassName}
                      style={{
                        left: `${position.x}px`,
                        top: `${position.y}px`,
                      }}
                      onPointerDown={(event) => handlePointerDown(event, node.id)}
                      onClick={() => handleNodeClick(node.id)}
                      title={node.name}
                    >
                      <span className="node-network-node-badges" aria-hidden="true">
                        {isGateway ? <span className="node-network-node-badge gateway">G</span> : null}
                        {isBackupGateway ? <span className="node-network-node-badge backup">B</span> : null}
                        {isIncluded && !isGateway && !isBackupGateway ? (
                          <span className="node-network-node-badge included">R</span>
                        ) : null}
                      </span>
                      <span className="node-network-node-label">{truncateNodeLabel(node.name)}</span>
                    </button>
                  )
                })}
              </>
            )}
          </div>

          <div className="node-network-sidebar-block node-network-summary-block">
            <p className="node-network-sidebar-label">Network Summary</p>
            {includedNodeIds.length === 0 ? (
              <p className="node-network-sidebar-empty">No nodes are currently included in the radio network.</p>
            ) : (
              <div className="node-network-summary-list">
                {nodes
                  .filter((node) => includedNodeIds.includes(node.id))
                  .map((node) => {
                    const { isGateway, isBackupGateway, isIncluded } = getNodeRoles(
                      node.id,
                      gatewayNodeId,
                      backupGatewayNodeId,
                      includedNodeIds
                    )

                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={`node-network-summary-item${selectedNodeId === node.id ? " is-active" : ""}`}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <span className="node-network-summary-name">{node.name}</span>
                        <span className="node-network-summary-tags">
                          {isGateway ? <span className="node-network-status-pill gateway">Gateway</span> : null}
                          {isBackupGateway ? <span className="node-network-status-pill backup">Backup</span> : null}
                          {isIncluded ? <span className="node-network-status-pill included">In Network</span> : null}
                        </span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>

          <aside className="node-network-sidebar">
            <div className="node-network-sidebar-block">
              <p className="node-network-sidebar-label">Gateway</p>
              <div className="node-network-gateway-list">
                <div className="node-network-gateway-row">
                  <span className="node-network-gateway-rank">1.</span>
                  <span className="node-network-sidebar-value">{formatNodeName(gatewayNodeId, nodesById)}</span>
                </div>
                <div className="node-network-gateway-row">
                  <span className="node-network-gateway-rank">2.</span>
                  <span className="node-network-sidebar-value">{formatNodeName(backupGatewayNodeId, nodesById)}</span>
                </div>
              </div>
              <div className="node-network-action-list compact">
                <button
                  type="button"
                  className="secondary-action node-network-action-button"
                  onClick={() => selectedNode && assignGatewayRole("primary", selectedNode.id)}
                  disabled={!selectedNode}
                >
                  Add Gateway
                </button>
                <button
                  type="button"
                  className="secondary-action node-network-action-button"
                  onClick={() => selectedNode && assignGatewayRole("backup", selectedNode.id)}
                  disabled={!selectedNode}
                >
                  Add Backup Gateway
                </button>
              </div>
            </div>

            <div className="node-network-sidebar-block">
              <p className="node-network-sidebar-label">Selected Node</p>
              <p className="node-network-sidebar-detail">{includedNodeIds.length} node(s) in the radio network</p>
              {selectedNode ? (
                <>
                  <p className="node-network-sidebar-value">{selectedNode.name}</p>
                  <div className="node-network-meta-row">
                    {gatewayNodeId === selectedNode.id ? (
                      <span className="node-network-status-pill gateway">Gateway</span>
                    ) : null}
                    {backupGatewayNodeId === selectedNode.id ? (
                      <span className="node-network-status-pill backup">Backup Gateway</span>
                    ) : null}
                    {includedNodeIds.includes(selectedNode.id) ? (
                      <span className="node-network-status-pill included">In Radio Network</span>
                    ) : (
                      <span className="node-network-status-pill muted">Excluded</span>
                    )}
                  </div>
                  <div className="node-network-action-list">
                    <button
                      type="button"
                      className="secondary-action node-network-action-button"
                      onClick={() => toggleNodeIncluded(selectedNode.id)}
                    >
                      {includedNodeIds.includes(selectedNode.id) ? "Remove from Radio Network" : "Include in Radio Network"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action node-network-action-button"
                      onClick={() => {
                        if (gatewayNodeId === selectedNode.id) {
                          setGatewayNodeId(null)
                        }

                        if (backupGatewayNodeId === selectedNode.id) {
                          setBackupGatewayNodeId(null)
                        }
                      }}
                      disabled={gatewayNodeId !== selectedNode.id && backupGatewayNodeId !== selectedNode.id}
                    >
                      Clear Gateway Role
                    </button>
                  </div>
                </>
              ) : (
                <p className="node-network-sidebar-empty">Click a node to manage its network role.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

export default NodeNetwork
