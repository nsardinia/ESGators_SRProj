import { useEffect, useRef, useState } from "react"
import { onValue, ref } from "firebase/database"
import Button from "./ui/button"
import { getAuthHeaders } from "../lib/api"
import { Card, CardContent } from "./ui/card"
import { API_BASE_URL } from "../lib/api"
import { auth } from "../lib/firebase-auth"
import { database } from "../lib/firebase-database"
import "./NodeNetwork.css"

const NODE_RADIUS = 42
const CANVAS_WIDTH = 760
const CANVAS_HEIGHT = 520
const DRAG_THRESHOLD = 6
const WIFI_STREAM_WINDOW_MS = 12000

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

function buildRadioNetworkConfig(includedNodeIds, gatewayNodeId, backupGatewayNodeId) {
  const gateways = [gatewayNodeId, backupGatewayNodeId].filter(Boolean)

  return {
    version: 1,
    gateways,
    nodes: includedNodeIds.map((nodeId) => {
      const isGatewayNode = nodeId === gatewayNodeId || nodeId === backupGatewayNodeId
      const preferredGateway =
        nodeId === gatewayNodeId || nodeId === backupGatewayNodeId
          ? nodeId
          : gatewayNodeId || backupGatewayNodeId || nodeId

      let fallbackGateway = 0

      if (nodeId === gatewayNodeId && backupGatewayNodeId) {
        fallbackGateway = backupGatewayNodeId
      } else if (nodeId === backupGatewayNodeId && gatewayNodeId) {
        fallbackGateway = gatewayNodeId
      } else if (
        nodeId !== gatewayNodeId &&
        nodeId !== backupGatewayNodeId &&
        gatewayNodeId &&
        backupGatewayNodeId
      ) {
        fallbackGateway = backupGatewayNodeId
      }

      return {
        nodeId,
        role: isGatewayNode ? "gateway" : "client",
        preferredGateway,
        fallbackGateway,
        enabled: true,
      }
    }),
  }
}

function normalizeNetworkStatus(rawStatus) {
  const normalized = String(rawStatus || "").trim().toLowerCase()

  if (["up", "available", "online", "healthy", "connected"].includes(normalized)) {
    return "up"
  }

  if (["down", "unavailable", "offline", "disconnected", "stale"].includes(normalized)) {
    return "down"
  }

  return "unknown"
}

function formatStatusLabel(status) {
  if (status === "up") {
    return "Up"
  }

  if (status === "down") {
    return "Down"
  }

  if (status === "wifi") {
    return "Streaming over WiFi"
  }

  if (status === "waiting") {
    return "Waiting for connection"
  }

  return "Unknown"
}

function formatUpdatedAt(updatedAtMs) {
  if (typeof updatedAtMs !== "number") {
    return "No live timestamp yet"
  }

  return new Date(updatedAtMs).toLocaleString()
}

function fingerprintSnapshot(value) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return ""
  }
}

function NodeNetwork({ nodes, ownerFirebaseUid }) {
  const networkRef = useRef(null)
  const dragStateRef = useRef(null)
  const hasLoadedInitialConfigRef = useRef(false)
  const previousConfigFingerprintRef = useRef("")
  const [nodePositions, setNodePositions] = useState({})
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [gatewayNodeId, setGatewayNodeId] = useState(null)
  const [backupGatewayNodeId, setBackupGatewayNodeId] = useState(null)
  const [includedNodeIds, setIncludedNodeIds] = useState([])
  const [configStatus, setConfigStatus] = useState("")
  const [isPublishingConfig, setIsPublishingConfig] = useState(false)
  const [publishedRadioNetwork, setPublishedRadioNetwork] = useState(null)
  const [networkStatusSnapshots, setNetworkStatusSnapshots] = useState({})
  const [wifiSnapshotsByNodeId, setWifiSnapshotsByNodeId] = useState({})
  const [liveStatusError, setLiveStatusError] = useState("")
  const [lastConfigChangeAt, setLastConfigChangeAt] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [canvasSize, setCanvasSize] = useState({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  })

  const draftGatewayNodeId = gatewayNodeId
  const draftBackupGatewayNodeId = backupGatewayNodeId
  const draftIncludedNodeIds = includedNodeIds
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const configuredGatewayIds = publishedRadioNetwork?.gateways?.filter(Boolean) || []

  const freshestGatewaySnapshotEntry = Object.values(networkStatusSnapshots)
    .filter(Boolean)
    .sort((left, right) => (right.payload?.updatedAtMs || 0) - (left.payload?.updatedAtMs || 0))[0] || null
  const freshestGatewaySnapshot = freshestGatewaySnapshotEntry?.payload || null
  const hasActiveRadioStatus = Boolean(
    freshestGatewaySnapshotEntry && freshestGatewaySnapshotEntry.receivedAt >= lastConfigChangeAt
  )

  const publishedIncludedNodeIds = (publishedRadioNetwork?.nodes || [])
    .filter((node) => node?.enabled !== false && node?.nodeId)
    .map((node) => node.nodeId)

  const publishedGatewayNodeId = publishedRadioNetwork?.gateways?.[0] || null
  const publishedBackupGatewayNodeId = publishedRadioNetwork?.gateways?.[1] || null
  const activeIncludedNodeIds = hasActiveRadioStatus ? publishedIncludedNodeIds : []
  const activeGatewayNodeId = hasActiveRadioStatus ? publishedGatewayNodeId : null
  const activeBackupGatewayNodeId = hasActiveRadioStatus ? publishedBackupGatewayNodeId : null

  const networkStatusNodesByDeviceId = new Map(
    (freshestGatewaySnapshot?.nodes || [])
      .filter((node) => node?.deviceId)
      .map((node) => [node.deviceId, node])
  )

  const networkNodeStates = nodes.map((node) => {
    const statusEntry = networkStatusNodesByDeviceId.get(node.id)
    const isTrackedByPublishedConfig = activeIncludedNodeIds.includes(node.id)
    const wifiSnapshot = wifiSnapshotsByNodeId[node.id]
    const isWifiStreaming =
      typeof wifiSnapshot?.lastChangeReceivedAt === "number" &&
      nowMs - wifiSnapshot.lastChangeReceivedAt <= WIFI_STREAM_WINDOW_MS
    const normalizedStatus = isTrackedByPublishedConfig
      ? statusEntry
        ? normalizeNetworkStatus(statusEntry.status)
        : freshestGatewaySnapshot && hasActiveRadioStatus
          ? "down"
          : "unknown"
      : isWifiStreaming
        ? "wifi"
        : "waiting"

    return {
      ...node,
      networkStatus: normalizedStatus,
      networkStatusRaw: statusEntry?.status || (normalizedStatus === "down" ? "missing" : ""),
      route: statusEntry || null,
      isTrackedByPublishedConfig,
      isWifiStreaming,
    }
  })

  const networkNodeStatesById = new Map(networkNodeStates.map((node) => [node.id, node]))
  const publishedDownNodes = networkNodeStates.filter(
    (node) => node.isTrackedByPublishedConfig && node.networkStatus === "down"
  )
  const publishedUnknownNodes = networkNodeStates.filter(
    (node) => node.isTrackedByPublishedConfig && node.networkStatus === "unknown"
  )

  let radioHealthTone = "unknown"
  let radioHealthLabel = "No live radio network status yet"

  if (publishedIncludedNodeIds.length > 0 && !hasActiveRadioStatus) {
    radioHealthTone = "unknown"
    radioHealthLabel = "Radio config changed, waiting for nodes to reconnect"
  } else if (publishedIncludedNodeIds.length > 0 && freshestGatewaySnapshot) {
    if (publishedDownNodes.length === 0 && publishedUnknownNodes.length === 0) {
      radioHealthTone = "healthy"
      radioHealthLabel = "Radio network fully functional"
    } else if (publishedDownNodes.length > 0) {
      radioHealthTone = "degraded"
      radioHealthLabel = `${publishedDownNodes.length} node${publishedDownNodes.length === 1 ? "" : "s"} down`
    } else {
      radioHealthTone = "unknown"
      radioHealthLabel = `${publishedUnknownNodes.length} node${publishedUnknownNodes.length === 1 ? "" : "s"} awaiting status`
    }
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!database || !ownerFirebaseUid) {
      setPublishedRadioNetwork(null)
      return undefined
    }

    const configRef = ref(database, `users/${ownerFirebaseUid}/config`)
    const unsubscribe = onValue(
      configRef,
      (snapshot) => {
        const nextConfig = snapshot.val()
        const nextFingerprint = fingerprintSnapshot(nextConfig)
        const nextRadioNetwork =
          nextConfig &&
          typeof nextConfig === "object" &&
          nextConfig["radio-network"] &&
          typeof nextConfig["radio-network"] === "object"
            ? nextConfig["radio-network"]
            : null

        if (!hasLoadedInitialConfigRef.current) {
          hasLoadedInitialConfigRef.current = true
        } else if (
          previousConfigFingerprintRef.current &&
          previousConfigFingerprintRef.current !== nextFingerprint
        ) {
          setLastConfigChangeAt(Date.now())
        }

        previousConfigFingerprintRef.current = nextFingerprint
        setPublishedRadioNetwork(nextRadioNetwork)
        setLiveStatusError("")
      },
      (error) => {
        setPublishedRadioNetwork(null)
        setLiveStatusError(error.message || "Failed to load live radio network configuration")
      }
    )

    return () => unsubscribe()
  }, [ownerFirebaseUid])

  useEffect(() => {
    if (!publishedRadioNetwork?.nodes?.length) {
      setGatewayNodeId(null)
      setBackupGatewayNodeId(null)
      setIncludedNodeIds([])
      return
    }

    setGatewayNodeId(publishedRadioNetwork.gateways?.[0] || null)
    setBackupGatewayNodeId(publishedRadioNetwork.gateways?.[1] || null)
    setIncludedNodeIds(
      publishedRadioNetwork.nodes
        .filter((node) => node?.enabled !== false && node?.nodeId)
        .map((node) => node.nodeId)
    )
  }, [publishedRadioNetwork])

  useEffect(() => {
    if (!database || !ownerFirebaseUid || configuredGatewayIds.length === 0) {
      setNetworkStatusSnapshots({})
      return undefined
    }

    const unsubscribes = configuredGatewayIds.map((gatewayId) =>
      onValue(
        ref(database, `users/${ownerFirebaseUid}/devices/${gatewayId}/networkStatus/latest`),
        (snapshot) => {
          setNetworkStatusSnapshots((currentSnapshots) => {
            const nextValue = snapshot.val()

            if (!nextValue) {
              const { [gatewayId]: _removedGateway, ...rest } = currentSnapshots
              return rest
            }

            return {
              ...currentSnapshots,
              [gatewayId]: {
                payload: nextValue,
                receivedAt: Date.now(),
              },
            }
          })
          setLiveStatusError("")
        },
        (error) => {
          setLiveStatusError(error.message || "Failed to load live network status")
        }
      )
    )

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [configuredGatewayIds.join("|"), ownerFirebaseUid])

  useEffect(() => {
    if (!database || !ownerFirebaseUid || nodes.length === 0) {
      setWifiSnapshotsByNodeId({})
      return undefined
    }

    const unsubscribes = nodes.map((node) =>
      onValue(ref(database, `users/${ownerFirebaseUid}/devices/${node.id}`), (snapshot) => {
        const nextFingerprint = fingerprintSnapshot(snapshot.val())

        setWifiSnapshotsByNodeId((currentSnapshots) => {
          const existingSnapshot = currentSnapshots[node.id]

          if (!existingSnapshot) {
            return {
              ...currentSnapshots,
              [node.id]: {
                fingerprint: nextFingerprint,
                lastChangeReceivedAt: null,
              },
            }
          }

          if (existingSnapshot.fingerprint === nextFingerprint) {
            return currentSnapshots
          }

          return {
            ...currentSnapshots,
            [node.id]: {
              fingerprint: nextFingerprint,
              lastChangeReceivedAt: Date.now(),
            },
          }
        })
      })
    )

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [nodes, ownerFirebaseUid])

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
  const selectedNodeState = selectedNodeId ? networkNodeStatesById.get(selectedNodeId) : null
  const draftIncludedNodes = nodes.filter((node) => draftIncludedNodeIds.includes(node.id))
  const draftRadioNetwork = buildRadioNetworkConfig(
    draftIncludedNodeIds,
    draftGatewayNodeId,
    draftBackupGatewayNodeId
  )

  const handleExportNetwork = () => {
    const radioNetwork = buildRadioNetworkConfig(
      draftIncludedNodeIds,
      draftGatewayNodeId,
      draftBackupGatewayNodeId
    )

    const blob = new Blob([JSON.stringify(radioNetwork, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = "radio-network-config.json"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setConfigStatus("Downloaded the current radio network configuration JSON.")
  }

  const handlePublishNetwork = async () => {
    setIsPublishingConfig(true)
    setConfigStatus("")

    try {
      const radioNetwork = buildRadioNetworkConfig(
        draftIncludedNodeIds,
        draftGatewayNodeId,
        draftBackupGatewayNodeId
      )
      const response = await fetch(`${API_BASE_URL}/configuration/radio-network`, {
        method: "POST",
        headers: await getAuthHeaders(auth.currentUser, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(radioNetwork),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.message || "Failed to send configuration to Firebase")
      }

      setConfigStatus(`Configuration saved to Firebase at ${payload.path || `users/${ownerFirebaseUid}/config/radio-network`}.`)
    } catch (error) {
      setConfigStatus(error.message || "Failed to send configuration to Firebase")
    } finally {
      setIsPublishingConfig(false)
    }
  }

  return (
    <section className="node-network-panel">
      <div className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[14px] py-3 text-[0.95rem] text-[var(--muted)]">
        <div>
          <span className="text-[var(--text)]">Node Network</span>
          <p className="mt-1 text-[0.78rem] leading-[1.35] text-[#b8c4d7]">
            Drag nodes to reposition them. Click a node to manage gateway roles and radio-network inclusion.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`node-network-health-pill is-${radioHealthTone}`}>{radioHealthLabel}</span>
            {hasActiveRadioStatus && freshestGatewaySnapshot?.gatewayDeviceId ? (
              <span className="node-network-meta-pill">
                Live gateway: {truncateNodeLabel(nodesById.get(freshestGatewaySnapshot.gatewayDeviceId)?.name || freshestGatewaySnapshot.gatewayDeviceId)}
              </span>
            ) : null}
            {hasActiveRadioStatus && freshestGatewaySnapshot ? (
              <span className="node-network-meta-pill">Updated {formatUpdatedAt(freshestGatewaySnapshot.updatedAtMs)}</span>
            ) : null}
          </div>
          {liveStatusError ? <p className="mt-2 text-[0.78rem] leading-[1.35] text-[#fca5a5]">{liveStatusError}</p> : null}
          {configStatus && <p className="mt-2 text-[0.78rem] leading-[1.35] text-[#b8c4d7]">{configStatus}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleExportNetwork}
            disabled={draftIncludedNodeIds.length === 0}
          >
            Download Config JSON
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handlePublishNetwork}
            disabled={draftIncludedNodeIds.length === 0 || isPublishingConfig || !ownerFirebaseUid}
          >
            {isPublishingConfig ? "Sending..." : "Send to Firebase"}
          </Button>
        </div>
      </div>

      <div className="node-network-layout">
        <div className="node-network-shell">
          <div className="node-network-canvas" ref={networkRef}>
            {nodes.length === 0 ? (
              <div className="max-w-[420px] rounded-[12px] border border-dashed border-[rgba(154,164,181,0.35)] bg-[rgba(255,255,255,0.02)] px-5 py-[18px] text-[var(--muted)]">
                Create a node first to start arranging your layout.
              </div>
            ) : (
              <>
                <svg className="node-network-flow-layer" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <marker id="node-network-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(125, 211, 252, 0.9)" />
                    </marker>
                    <marker id="node-network-arrow-alert" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(248, 113, 113, 0.95)" />
                    </marker>
                  </defs>
                  {draftIncludedNodeIds.map((nodeId) => {
                    const nodePosition = nodePositions[nodeId]
                    const targetGatewayId =
                      nodeId === draftGatewayNodeId || nodeId === draftBackupGatewayNodeId
                        ? null
                        : draftGatewayNodeId || draftBackupGatewayNodeId
                    const gatewayPosition = targetGatewayId ? nodePositions[targetGatewayId] : null
                    const nodeState = networkNodeStatesById.get(nodeId)
                    const isDown = nodeState?.networkStatus === "down"

                    if (!nodePosition || !gatewayPosition) {
                      return null
                    }

                    return (
                      <line
                        key={`flow-${nodeId}`}
                        x1={nodePosition.x}
                        y1={nodePosition.y}
                        x2={gatewayPosition.x}
                        y2={gatewayPosition.y}
                        className={isDown ? "is-alert" : ""}
                        markerEnd={`url(#${isDown ? "node-network-arrow-alert" : "node-network-arrow"})`}
                      />
                    )
                  })}
                </svg>
                {nodes.map((node) => {
                  const position = nodePositions[node.id] || buildInitialPosition(0, nodes.length, canvasSize)
                  const isSelected = selectedNodeId === node.id
                  const { isIncluded, isGateway, isBackupGateway } = getNodeRoles(
                    node.id,
                    draftGatewayNodeId,
                    draftBackupGatewayNodeId,
                    draftIncludedNodeIds
                  )
                  const nodeClassName = [
                    "node-network-node",
                    isSelected ? "is-selected" : "",
                    isIncluded ? "is-included" : "",
                    isGateway ? "is-gateway" : "",
                    isBackupGateway ? "is-backup-gateway" : "",
                    networkNodeStatesById.get(node.id)?.networkStatus === "down" ? "is-down" : "",
                    networkNodeStatesById.get(node.id)?.networkStatus === "unknown" ? "is-unknown" : "",
                    networkNodeStatesById.get(node.id)?.networkStatus === "wifi" ? "is-wifi" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                  const liveNodeState = networkNodeStatesById.get(node.id)

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
                        {isGateway ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#facc15] text-[0.64rem] font-extrabold leading-none text-[#08111b]">G</span> : null}
                        {isBackupGateway ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f87171] text-[0.64rem] font-extrabold leading-none text-[#08111b]">B</span> : null}
                        {isIncluded && !isGateway && !isBackupGateway ? (
                          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#4ade80] text-[0.64rem] font-extrabold leading-none text-[#08111b]">R</span>
                        ) : null}
                      </span>
                      <span className="text-[0.78rem] font-bold leading-[1.2]">{truncateNodeLabel(node.name)}</span>
                      <span className={`node-network-node-status is-${liveNodeState?.networkStatus || "unknown"}`}>
                        {formatStatusLabel(liveNodeState?.networkStatus)}
                      </span>
                    </button>
                  )
                })}
              </>
            )}
          </div>

          <Card className="node-network-designer-block shadow-none">
            <CardContent className="p-3">
              <p className="mb-[6px] text-[0.72rem] uppercase tracking-[0.08em] text-[#aebbd0]">Network Designer</p>
              <p className="mb-2 text-[0.78rem] leading-[1.35] text-[var(--muted)]">
                This is the configuration currently being prepared to send to Firebase.
              </p>
              {draftIncludedNodes.length === 0 ? (
                <p className="m-0 leading-[1.35] text-[var(--muted)]">No draft radio nodes selected yet.</p>
              ) : (
                <div className="node-network-summary-list">
                  {draftIncludedNodes.map((node) => {
                    const { isGateway, isBackupGateway, isIncluded } = getNodeRoles(
                      node.id,
                      draftGatewayNodeId,
                      draftBackupGatewayNodeId,
                      draftIncludedNodeIds
                    )

                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={`node-network-summary-item ${selectedNodeId === node.id ? "is-selected" : ""}`}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <span className="min-w-0 text-[0.82rem] font-bold leading-[1.3]">{node.name}</span>
                        <span className="flex flex-wrap justify-end gap-1">
                          {isGateway ? <span className="inline-flex items-center rounded-full bg-[rgba(250,204,21,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#fde68a]">Gateway</span> : null}
                          {isBackupGateway ? <span className="inline-flex items-center rounded-full bg-[rgba(248,113,113,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#fecaca]">Backup</span> : null}
                          {isIncluded ? <span className="inline-flex items-center rounded-full bg-[rgba(74,222,128,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#bbf7d0]">Planned</span> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              {draftIncludedNodes.length > 0 ? (
                <div className="node-network-draft-meta">
                  <p className="m-0">Gateways: {draftRadioNetwork.gateways.length}</p>
                  <p className="m-0">Nodes: {draftRadioNetwork.nodes.length}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <aside className="node-network-sidebar">
            <Card className="shadow-none">
              <CardContent className="p-3">
                <p className="mb-[6px] text-[0.72rem] uppercase tracking-[0.08em] text-[#aebbd0]">Gateway</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-[10px]">
                    <span className="min-w-5 text-[0.82rem] font-bold text-[#94a3b8]">1.</span>
                    <span className="m-0 leading-[1.35] text-[var(--text)]">{formatNodeName(draftGatewayNodeId, nodesById)}</span>
                  </div>
                  <div className="flex items-center gap-[10px]">
                    <span className="min-w-5 text-[0.82rem] font-bold text-[#94a3b8]">2.</span>
                    <span className="m-0 leading-[1.35] text-[var(--text)]">{formatNodeName(draftBackupGatewayNodeId, nodesById)}</span>
                  </div>
                </div>
                <div className="mt-[10px] flex flex-col gap-[6px]">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => selectedNode && assignGatewayRole("primary", selectedNode.id)}
                    disabled={!selectedNode}
                  >
                    Add Gateway
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => selectedNode && assignGatewayRole("backup", selectedNode.id)}
                    disabled={!selectedNode}
                  >
                    Add Backup Gateway
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardContent className="p-3">
                <p className="mb-[6px] text-[0.72rem] uppercase tracking-[0.08em] text-[#aebbd0]">Selected Node</p>
                <p className="mb-[10px] text-[0.8rem] leading-[1.35] text-[var(--muted)]">{draftIncludedNodeIds.length} planned radio node(s)</p>
                {selectedNode ? (
                  <>
                    <p className="m-0 leading-[1.35] text-[var(--text)]">{selectedNode.name}</p>
                    <div className="mt-[10px] flex flex-wrap gap-[6px]">
                      <span className={`node-network-summary-status is-${selectedNodeState?.networkStatus || "unknown"}`}>
                        {formatStatusLabel(selectedNodeState?.networkStatus)}
                      </span>
                      {draftGatewayNodeId === selectedNode.id ? (
                        <span className="inline-flex items-center rounded-full bg-[rgba(250,204,21,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#fde68a]">Gateway</span>
                      ) : null}
                      {draftBackupGatewayNodeId === selectedNode.id ? (
                        <span className="inline-flex items-center rounded-full bg-[rgba(248,113,113,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#fecaca]">Backup Gateway</span>
                      ) : null}
                      {draftIncludedNodeIds.includes(selectedNode.id) ? (
                        <span className="inline-flex items-center rounded-full bg-[rgba(74,222,128,0.16)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#bbf7d0]">In Radio Network</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[rgba(148,163,184,0.14)] px-2 py-1 text-[0.7rem] font-bold leading-none text-[#cbd5e1]">Excluded</span>
                      )}
                    </div>
                    {selectedNodeState?.route ? (
                      <div className="node-network-status-details">
                        <p className="m-0">Role: {selectedNodeState.route.role || "Unknown"}</p>
                        <p className="m-0">Hops: {selectedNodeState.route.hops ?? 0}</p>
                        <p className="m-0">Via: {selectedNodeState.route.viaNodeId || selectedNodeState.route.viaAddr || "Direct"}</p>
                      </div>
                    ) : null}
                    <div className="mt-[10px] flex flex-col gap-[6px]">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => toggleNodeIncluded(selectedNode.id)}
                      >
                        {includedNodeIds.includes(selectedNode.id) ? "Remove from Radio Network" : "Include in Radio Network"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
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
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="m-0 leading-[1.35] text-[var(--muted)]">Click a node to manage its network role.</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </section>
  )
}

export default NodeNetwork
