/**
 * Dashboard Page
 *
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useState } from "react"

const grafanaDashboardUrl = import.meta.env.VITE_GRAFANA_DASHBOARD_URL?.trim()
const backendBaseUrl = (import.meta.env.VITE_BACKEND_URL || "http://localhost:5000").replace(/\/$/, "")
const exportRanges = [
  { key: "day", label: "Export Day CSV" },
  { key: "week", label: "Export Week CSV" },
  { key: "month", label: "Export Month CSV" },
]

const DashboardPage = () => {
  const [activeRange, setActiveRange] = useState("")
  const [statusMessage, setStatusMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  function handleOpenGrafana() {
    if (!grafanaDashboardUrl) {
      return
    }

    window.open(grafanaDashboardUrl, "_blank", "noopener,noreferrer")
  }

  async function handleExport(range) {
    setActiveRange(range)
    setErrorMessage("")
    setStatusMessage(`${range} export preparing...`)

    try {
      const response = await fetch(`${backendBaseUrl}/iot/export/${range}`)

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Export failed")
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const contentDisposition = response.headers.get("content-disposition") || ""
      const matchedFileName = contentDisposition.match(/filename=\"?([^"]+)\"?/)
      const fileName = matchedFileName?.[1] || `sensor-readings-${range}.csv`

      anchor.href = downloadUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(downloadUrl)
      setStatusMessage(`${range} export downloaded.`)
    } catch (error) {
      setStatusMessage("")
      setErrorMessage(error.message || "Export failed")
    } finally {
      setActiveRange("")
    }
  }

  return (
    <section className="workspace-content">
      <p className="page-kicker">Dashboard</p>
      <h1 className="page-title">Data Export</h1>
      <p className="page-subtitle">
        Download CSV exports for day, week, or month. If the database is empty, fallback TH sample data will be downloaded.
      </p>

      <div className="dashboard-grid">
        <article className="dashboard-card">
          <p className="data-card-label">CSV Export</p>
          <div className="export-button-row">
            {exportRanges.map((range) => (
              <button
                key={range.key}
                type="button"
                className="primary-action export-button"
                onClick={() => handleExport(range.key)}
                disabled={Boolean(activeRange)}
              >
                {activeRange === range.key ? "Preparing..." : range.label}
              </button>
            ))}
          </div>
          {statusMessage ? <p className="export-status">{statusMessage}</p> : null}
          {errorMessage ? <p className="export-error">{errorMessage}</p> : null}
        </article>

        <article className="dashboard-card">
          <p className="data-card-label">Grafana</p>
          <h2 className="dashboard-card-title">Monitoring dashboard</h2>
          <p className="dashboard-card-copy">
            Open the live Grafana dashboard in a new tab when you need the full metrics view.
          </p>
          {grafanaDashboardUrl ? (
            <button
              type="button"
              className="secondary-action dashboard-link"
              onClick={handleOpenGrafana}
            >
              Open Grafana Dashboard
            </button>
          ) : (
            <p className="export-error">
              Set <strong>VITE_GRAFANA_DASHBOARD_URL</strong> in <strong>frontend/.env</strong>.
            </p>
          )}
        </article>
      </div>
    </section>
  )
}

export default DashboardPage
