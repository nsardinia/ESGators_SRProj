/**
 * Dashboard Page
 * 
 * TODO: Replace with Grafana dashbaord.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
import axios from "axios"
import { useEffect, useState } from "react"
import { API_BASE_URL } from "../lib/api"

const grafanaDashboardUrl = import.meta.env.VITE_GRAFANA_DASHBOARD_URL

const DashboardPage = () => {
  useEffect(() => {
    if (grafanaDashboardUrl) {
      window.location.replace(grafanaDashboardUrl)
    }
  }, [])

  if (!grafanaDashboardUrl) {
    return (
      <section className="workspace-content">
        <p className="page-kicker">Dashboard</p>
        <h1 className="page-title">Grafana URL is missing</h1>
        <p className="page-subtitle">
          Set <strong>VITE_GRAFANA_DASHBOARD_URL</strong> in <strong>frontend/.env</strong> with your Grafana dashboard share URL.
        </p>
      </section>
    )
  }

  return (
    <section className="workspace-content">
      <p className="page-kicker">Dashboard</p>
      <h1 className="page-title">Redirecting to Grafana...</h1>
      <p className="page-subtitle">If you are not redirected automatically, open the dashboard link below.</p>
      <a href={grafanaDashboardUrl} target="_blank" rel="noreferrer">
        Open Grafana Dashboard
      </a>
    </section>
  )
}

export default DashboardPage
