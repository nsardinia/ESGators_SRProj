/**
 * Dashboard Page
 *
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import { useState } from "react"
import { useAuth } from "../components/AuthContext"
import { BACKEND_API_BASE_URL } from "../lib/api"

const exportRanges = [
  { key: "day", label: "Export Day CSV" },
  { key: "week", label: "Export Week CSV" },
  { key: "month", label: "Export Month CSV" },
]
const cardClassName =
  "rounded-2xl border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent),var(--bg-elevated)] p-[18px] shadow-[0_18px_44px_rgba(0,0,0,0.24)]"
const cardLabelClassName =
  "mb-[10px] text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]"
const actionButtonClassName =
  "inline-flex min-w-[170px] items-center justify-center rounded-[9px] border border-[rgba(62,207,142,0.45)] bg-[rgba(62,207,142,0.18)] px-[13px] py-[9px] text-center text-[var(--text)] text-[#d3f5e4] transition-[opacity,transform,background-color,border-color] duration-150 hover:border-[rgba(62,207,142,0.6)] hover:bg-[rgba(62,207,142,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
const secondaryButtonClassName =
  "inline-flex items-center justify-center rounded-[9px] border border-[var(--border)] bg-[#1a2232] px-[13px] py-[9px] text-[var(--text)] transition-colors duration-150 hover:border-[#334055] hover:bg-[#202a3d]"

function getGrafanaDashboardUrl() {
  return import.meta.env.VITE_GRAFANA_DASHBOARD_URL?.trim()
}

function buildGrafanaDashboardUrl(baseUrl, user) {
  if (!baseUrl) {
    return ""
  }

  const dashboardUrl = new URL(baseUrl)

  if (user?.uid) {
    dashboardUrl.searchParams.set("var-owner_uid", user.uid)
  }

  if (user?.email) {
    dashboardUrl.searchParams.set("var-owner_email", user.email)
  }

  return dashboardUrl.toString()
}

const DashboardPage = () => {
  const { user } = useAuth()
  const [activeRange, setActiveRange] = useState("")
  const [statusMessage, setStatusMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const grafanaDashboardUrl = buildGrafanaDashboardUrl(getGrafanaDashboardUrl(), user)

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
      const response = await fetch(`${BACKEND_API_BASE_URL}/iot/export/${range}`)

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
    <section className="max-w-[940px]">
      <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        Dashboard
      </p>
      <h1 className="mb-2 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold text-[var(--text)]">
        Data Export
      </h1>
      <p className="mb-[18px] text-base font-medium leading-7 text-[var(--muted)]">
        Download CSV exports for day, week, or month. If the database is empty, fallback TH sample data will be downloaded.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <article className={cardClassName}>
          <p className={cardLabelClassName}>CSV Export</p>
          <div className="flex flex-wrap gap-[10px]">
            {exportRanges.map((range) => (
              <button
                key={range.key}
                type="button"
                className={actionButtonClassName}
                onClick={() => handleExport(range.key)}
                disabled={Boolean(activeRange)}
              >
                {activeRange === range.key ? "Preparing..." : range.label}
              </button>
            ))}
          </div>
          {statusMessage ? (
            <p className="mt-[14px] text-[0.92rem] text-[#cdeedc]">{statusMessage}</p>
          ) : null}
          {errorMessage ? (
            <p className="mt-[14px] text-[0.92rem] text-[#f9b4b4]">{errorMessage}</p>
          ) : null}
        </article>

        <article className={cardClassName}>
          <p className={cardLabelClassName}>Grafana</p>
          <h2 className="mb-2 text-[1.05rem] font-semibold text-[var(--text)]">Monitoring dashboard</h2>
          <p className="mb-[14px] leading-7 text-[var(--muted)]">
            Open the live Grafana dashboard in a new tab. Your current account UID/email is appended as dashboard
            variables so panels can filter by owner.
          </p>
          {grafanaDashboardUrl ? (
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={handleOpenGrafana}
            >
              Open Grafana Dashboard
            </button>
          ) : (
            <p className="mt-[14px] text-[0.92rem] text-[#f9b4b4]">
              Set <strong>VITE_GRAFANA_DASHBOARD_URL</strong> in <strong>frontend/.env</strong>.
            </p>
          )}
        </article>
      </div>
    </section>
  )
}

export default DashboardPage
