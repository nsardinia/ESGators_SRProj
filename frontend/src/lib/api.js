/**
 * Set microservice addresses based on env. For now, just the fly.io backend vs local backend connected to supabase.
 * As additional backend services are developed, add them here.
 * 
 * 
 * Last edit: Nicholas Sardinia, 3/1/2026
 */
const LOCAL_API_BASE_URL = "http://localhost:3000"
const PRODUCTION_API_BASE_URL = "https://srprojmwbe.fly.dev"

function getApiBaseUrl() {
  const explicitBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const apiTarget = import.meta.env.VITE_API_TARGET?.trim().toLowerCase()

  if (apiTarget === "production") {
    return import.meta.env.VITE_API_PRODUCTION_BASE_URL?.trim() || PRODUCTION_API_BASE_URL
  }

  return import.meta.env.VITE_API_LOCAL_BASE_URL?.trim() || LOCAL_API_BASE_URL
}

const API_BASE_URL = getApiBaseUrl()

export { API_BASE_URL }
