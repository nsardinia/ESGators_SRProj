/**
 * Node management page.
 *
 * From this page, you can add / delete nodes, search nodes, and view real-time data.
 *
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useEffect, useMemo, useState } from "react"
import Button from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import DeviceMcpAssistant from "../components/DeviceMcpAssistant"
import Input from "../components/ui/input"
import Textarea from "../components/ui/textarea"
import { useAuth } from "../components/AuthContext"
import NodeLocationPicker from "../components/NodeLocationPicker"
import useOwnedNodes from "../hooks/useOwnedNodes"
import { API_BASE_URL, MWBE_API_BASE_URL, getAuthHeaders } from "../lib/api"
import {
  buildNodesWithLocations,
  formatCoordinateLabel,
  normalizeStoredLocation,
} from "../lib/nodeLocations"
import "./NodeMapPage.css"

function formatLastUpdate(updatedAtMs) {
  if (typeof updatedAtMs !== "number") {
    return "Waiting for telemetry"
  }

  return new Date(updatedAtMs).toLocaleString()
}

function NodeMapPage() {
  const { user } = useAuth()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [createdSecret, setCreatedSecret] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [latitudeInput, setLatitudeInput] = useState("")
  const [longitudeInput, setLongitudeInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [deletingNodeId, setDeletingNodeId] = useState("")
  const { createdNodes, error, loadingNodes, warning, setError, syncOwner, reloadNodes } = useOwnedNodes(user)

  const selectedLatitude = latitudeInput.trim() === "" ? null : Number(latitudeInput)
  const selectedLongitude = longitudeInput.trim() === "" ? null : Number(longitudeInput)
  const hasValidLocationSelection = normalizeStoredLocation({
    latitude: selectedLatitude,
    longitude: selectedLongitude,
  })
  const nodesWithLocations = useMemo(() => {
    return buildNodesWithLocations(createdNodes).nodes
  }, [createdNodes])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredNodes = nodesWithLocations.filter((node) => {
    if (!normalizedSearchQuery) {
      return true
    }

    return [node.name, node.description, node.id, node.locationLabel].some((value) =>
      String(value || "").toLowerCase().includes(normalizedSearchQuery)
    )
  })

  const handleOpenForm = () => {
    setError("")
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    if (submitting) {
      return
    }

    setIsFormOpen(false)
    setName("")
    setDescription("")
    setLatitudeInput("")
    setLongitudeInput("")
    setError("")
  }

  const handleSelectLocation = ({ latitude, longitude }) => {
    setLatitudeInput(latitude.toFixed(6))
    setLongitudeInput(longitude.toFixed(6))
    setError("")
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!user?.uid) {
      setError("You must be signed in to create a node.")
      return
    }

    if (!user.email) {
      setError("Your account needs an email address before a node can be created.")
      return
    }

    if (!hasValidLocationSelection) {
      setError("Select a node location on the map or enter valid latitude and longitude values.")
      return
    }

    setSubmitting(true)
    setError("")

    try {
      await syncOwner()

      const response = await fetch(`${API_BASE_URL}/devices/claim`, {
        method: "POST",
        headers: await getAuthHeaders(user, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          latitude: hasValidLocationSelection.latitude,
          longitude: hasValidLocationSelection.longitude,
          locationLabel: formatCoordinateLabel(hasValidLocationSelection.latitude, hasValidLocationSelection.longitude),
          isLocationUnknown: false,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.message || "Failed to create node")
      }

      await reloadNodes()
      setCreatedSecret({
        id: payload.deviceId,
        secret: payload.deviceSecret,
        name: name.trim(),
      })
      handleCloseForm()
    } catch (requestError) {
      setError(requestError.message || "Failed to create node")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteNode = async (node) => {
    if (!user?.uid) {
      setError("You must be signed in to delete a node.")
      return
    }

    const shouldDelete = window.confirm(`Delete ${node.name}? This will permanently remove it from your nodes.`)

    if (!shouldDelete) {
      return
    }

    setDeletingNodeId(node.id)
    setError("")

    try {
      await syncOwner()
      const response = await fetch(`${API_BASE_URL}/devices/${encodeURIComponent(node.id)}`, {
        method: "DELETE",
        headers: await getAuthHeaders(user),
      })

      if (response.status !== 204) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || "Failed to delete node")
      }

      await reloadNodes()
    } catch (requestError) {
      setError(requestError.message || "Failed to delete node")
    } finally {
      setDeletingNodeId("")
    }
  }

  useEffect(() => {
    if (!isAssistantOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsAssistantOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isAssistantOpen])

  return (
    <section className="node-map-page">
      <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Your Sensor Nodes</p>
      <div className="mb-[14px] flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[14px] py-3 text-[0.95rem] text-[var(--muted)]">
        <div>
          <span className="text-[var(--text)]">Node Search</span>
          <Input
            type="search"
            className="mt-2 max-w-[420px]"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name, description, or node ID"
            aria-label="Search nodes"
          />
        </div>
        <span className="text-[0.82rem] text-[#c7d1e1]">
          {filteredNodes.length} shown / {createdNodes.length} created
        </span>
      </div>
      {!loadingNodes && warning && (
        <div className="mb-[14px] rounded-[8px] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-[14px] py-3 text-[0.9rem] text-[#f6d28b]">
          {warning}
        </div>
      )}
      <div className="node-canvas">
        <div className="node-canvas-scroll">
          {loadingNodes && <div className="node-empty-state">Loading nodes...</div>}

          {!loadingNodes && error && (
            <div className="node-empty-state">
              {error}
              <div className="mt-3 text-[0.8rem] text-[#c7d1e1]">
                MWBE API: {MWBE_API_BASE_URL}
              </div>
            </div>
          )}

          {!loadingNodes && !error && createdNodes.length === 0 && (
            <div className="node-empty-state">
              No nodes yet. Create one to generate its node ID and API secret.
            </div>
          )}

          {!loadingNodes && !error && createdNodes.length > 0 && filteredNodes.length === 0 && (
            <div className="node-empty-state">
              No nodes match "{searchQuery.trim()}".
            </div>
          )}

          {filteredNodes.map((node) => (
            <article key={node.id} className="node-card-created">
              <div className="node-card-header">
                <p className="mb-2 text-base font-bold text-[#effbf4]">{node.name}</p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={submitting || deletingNodeId === node.id}
                  onClick={() => handleDeleteNode(node)}
                >
                  {deletingNodeId === node.id ? "Deleting..." : "Delete"}
                </Button>
              </div>
              <p className="mb-[14px] leading-[1.5] text-[#b8dec9]">{node.description}</p>
              <dl className="node-credentials">
                <div>
                  <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Node ID</dt>
                  <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.id}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Location</dt>
                  <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">
                    {node.locationLabel}
                    {node.isLocationUnknown ? " (unknown)" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Status</dt>
                  <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.status || "Unknown"}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Last Update</dt>
                  <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{formatLastUpdate(node.updatedAtMs)}</dd>
                </div>
                {node.telemetry && (
                  <>
                    <div>
                      <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Temperature</dt>
                      <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.telemetry.temperatureC ?? "N/A"} C</dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Humidity</dt>
                      <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.telemetry.humidityPct ?? "N/A"}%</dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">NO2</dt>
                      <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.telemetry.no2 ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#b4c2d8]">Sound Level</dt>
                      <dd className="m-0 break-words text-[0.84rem] leading-[1.45] text-white">{node.telemetry.soundLevel ?? "N/A"} dB</dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          ))}
        </div>

        <Button type="button" className="add-node size-11 rounded-full p-0 text-[30px] leading-none" onClick={handleOpenForm} aria-label="Create node">
          +
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="open-assistant"
          onClick={() => setIsAssistantOpen(true)}
          aria-label="Open device assistant"
        >
          <span className="open-assistant-badge" aria-hidden="true">AI</span>
        </Button>
      </div>

      {isFormOpen && (
        <div className="node-modal-backdrop" role="presentation" onClick={handleCloseForm}>
          <Card
            className="node-modal node-modal-setup"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-node-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardContent className="node-modal-content p-6">
              <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Node Setup</p>
              <h2 id="create-node-title" className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">
                Create a node
              </h2>
              <p className="mb-[18px] text-base font-medium text-[var(--muted)]">
                Submit the node details, choose its map position, and the backend will generate a node ID and API secret.
              </p>

              <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
                  <span>Node name</span>
                  <Input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="North greenhouse sensor"
                    maxLength={120}
                    required
                  />
                </label>

                <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
                  <span>Description</span>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Tracks humidity, temperature, and air quality."
                    rows="4"
                    maxLength={500}
                    required
                  />
                </label>

                <div className="node-location-fieldset">
                  <div className="node-location-fieldset-header">
                    <div>
                      <span className="node-location-fieldset-title">Node location</span>
                      <p className="node-location-fieldset-copy">
                        Choose a point on the map or enter latitude and longitude manually. This is required for node placement.
                      </p>
                    </div>
                    <div className="node-location-fieldset-status">
                      {hasValidLocationSelection
                        ? `Selected: ${formatCoordinateLabel(hasValidLocationSelection.latitude, hasValidLocationSelection.longitude)}`
                        : "No location selected yet"}
                    </div>
                  </div>

                  <div className="node-location-input-grid">
                    <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
                      <span>Latitude</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="-90"
                        max="90"
                        value={latitudeInput}
                        onChange={(event) => setLatitudeInput(event.target.value)}
                        placeholder="29.6516"
                        required
                      />
                    </label>

                    <label className="flex flex-col gap-[7px] text-[0.86rem] text-[var(--muted)]">
                      <span>Longitude</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="-180"
                        max="180"
                        value={longitudeInput}
                        onChange={(event) => setLongitudeInput(event.target.value)}
                        placeholder="-82.3248"
                        required
                      />
                    </label>
                  </div>

                  <NodeLocationPicker
                    latitude={hasValidLocationSelection?.latitude ?? null}
                    longitude={hasValidLocationSelection?.longitude ?? null}
                    onSelectLocation={handleSelectLocation}
                  />
                </div>

                {error && <p className="m-0 text-[0.86rem] text-[#fca5a5]">{error}</p>}

                <div className="node-modal-actions">
                  <Button type="button" variant="secondary" onClick={handleCloseForm} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Node"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {createdSecret && (
        <div className="node-modal-backdrop" role="presentation">
          <Card
            className="node-modal border-[rgba(248,113,113,0.28)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-secret-title"
          >
            <CardContent className="node-modal-content p-6">
              <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Secret Key</p>
              <h2 id="node-secret-title" className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold">
                Save this API secret now
              </h2>
              <p className="mb-[18px] text-base font-medium text-[var(--muted)]">
                This is the only time the secret for {createdSecret.name} will be shown. Store it securely and do not
                share it.
              </p>

              <div className="node-secret-panel">
                <p className="mb-[6px] text-[0.76rem] uppercase tracking-[0.08em] text-[#fecaca]">Node ID</p>
                <code className="mb-[14px] block rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(9,11,16,0.85)] px-3 py-2.5 text-[0.84rem] leading-[1.5] break-words text-[#fff7ed]">
                  {createdSecret.id}
                </code>
                <p className="mb-[6px] text-[0.76rem] uppercase tracking-[0.08em] text-[#fecaca]">API Secret</p>
                <code className="block rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(9,11,16,0.85)] px-3 py-2.5 text-[0.84rem] leading-[1.5] break-words text-[#fff7ed]">
                  {createdSecret.secret}
                </code>
              </div>

              <div className="node-modal-actions">
                <Button type="button" onClick={() => setCreatedSecret(null)}>
                  I saved it
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isAssistantOpen && (
        <div className="node-modal-backdrop" role="presentation" onClick={() => setIsAssistantOpen(false)}>
          <div
            className="assistant-modal-shell"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-assistant-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="assistant-modal-header">
              <div>
                <p id="device-assistant-title" className="mb-1 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-[#93c5fd]">
                  Device Assistant
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsAssistantOpen(false)}>
                Close
              </Button>
            </div>
            <DeviceMcpAssistant nodes={createdNodes} />
          </div>
        </div>
      )}
    </section>
  )
}

export default NodeMapPage
