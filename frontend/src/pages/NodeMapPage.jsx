/**
 * Node config page.
 * 
 * TODO: Add node configuration settings, public / private node access, etc.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useState } from "react"
import { useAuth } from "../components/AuthContext"
import useOwnedNodes from "../hooks/useOwnedNodes"
import { API_BASE_URL } from "../lib/api"

function formatRawDeviceData(telemetry) {
  if (!telemetry) {
    return "Waiting for telemetry"
  }

  return JSON.stringify(telemetry)
}

function NodeMapPage() {
  const { user } = useAuth()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [createdSecret, setCreatedSecret] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { createdNodes, error, loadingNodes, setError, syncOwner, reloadNodes } = useOwnedNodes(user)

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredNodes = createdNodes.filter((node) => {
    if (!normalizedSearchQuery) {
      return true
    }

    return [node.name, node.description, node.id].some((value) =>
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

    setSubmitting(true)
    setError("")

    try {
      const owner = await syncOwner()

      const response = await fetch(`${API_BASE_URL}/devices/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ownerUid: owner.firebase_uid,
          name: name.trim(),
          description: description.trim(),
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

  return (
    <section className="workspace-content node-map-page">
      <p className="page-kicker">Node Map</p>
      <div className="node-search">
        <div>
          <span>Node Search</span>
          <input
            type="search"
            className="node-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name, description, or node ID"
            aria-label="Search nodes"
          />
        </div>
        <span className="node-search-meta">
          {filteredNodes.length} shown / {createdNodes.length} created
        </span>
      </div>
      <div className="node-canvas">
        <div className="node-canvas-scroll">
          {loadingNodes && (
            <div className="node-empty-state">
              Loading nodes...
            </div>
          )}

          {!loadingNodes && createdNodes.length === 0 && (
            <div className="node-empty-state">
              No nodes yet. Create one to generate its node ID and API secret.
            </div>
          )}

          {!loadingNodes && createdNodes.length > 0 && filteredNodes.length === 0 && (
            <div className="node-empty-state">
              No nodes match "{searchQuery.trim()}".
            </div>
          )}

          {filteredNodes.map((node) => (
            <article key={node.id} className="node-card node-card-created">
              <p className="node-card-name">{node.name}</p>
              <p className="node-card-description">{node.description}</p>
              <dl className="node-credentials">
                <div>
                  <dt>Node ID</dt>
                  <dd>{node.id}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{node.status || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Last Update</dt>
                  <dd>{formatRawDeviceData(node.telemetry)}</dd>
                </div>
                {node.telemetry && (
                  <>
                    <div>
                      <dt>Temperature</dt>
                      <dd>{node.telemetry.temperatureC ?? "N/A"} C</dd>
                    </div>
                    <div>
                      <dt>Humidity</dt>
                      <dd>{node.telemetry.humidityPct ?? "N/A"}%</dd>
                    </div>
                    <div>
                      <dt>Battery</dt>
                      <dd>{node.telemetry.batteryVolts ?? "N/A"} V</dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          ))}
        </div>

        <button type="button" className="add-node" onClick={handleOpenForm} aria-label="Create node">
          +
        </button>
      </div>

      {isFormOpen && (
        <div className="node-modal-backdrop" role="presentation" onClick={handleCloseForm}>
          <section
            className="node-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-node-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="page-kicker">Node Setup</p>
            <h2 id="create-node-title" className="page-title">
              Create a node
            </h2>
            <p className="page-subtitle">
              Submit the node details and the backend will generate a node ID and API secret.
            </p>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>Node name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="North greenhouse sensor"
                  maxLength={120}
                  required
                />
              </label>

              <label className="field">
                <span>Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Tracks humidity, temperature, and air quality."
                  rows="4"
                  maxLength={500}
                  required
                />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <div className="node-modal-actions">
                <button type="button" className="secondary-action" onClick={handleCloseForm} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="primary-action" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Node"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {createdSecret && (
        <div className="node-modal-backdrop" role="presentation">
          <section
            className="node-modal node-secret-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-secret-title"
          >
            <p className="page-kicker">Secret Key</p>
            <h2 id="node-secret-title" className="page-title">
              Save this API secret now
            </h2>
            <p className="page-subtitle">
              This is the only time the secret for {createdSecret.name} will be shown. Store it securely and do not
              share it.
            </p>

            <div className="node-secret-panel">
              <p className="node-secret-label">Node ID</p>
              <code className="node-secret-value">{createdSecret.id}</code>
              <p className="node-secret-label">API Secret</p>
              <code className="node-secret-value">{createdSecret.secret}</code>
            </div>

            <div className="node-modal-actions">
              <button type="button" className="primary-action" onClick={() => setCreatedSecret(null)}>
                I saved it
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default NodeMapPage
