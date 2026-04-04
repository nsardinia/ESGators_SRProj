/**
 * Set microservice addresses based on env. For now, just the fly.io backend vs local backend connected to supabase.
 * As additional backend services are developed, add them here.
 * 
 * 
 * Last edit: Nicholas Sardinia, 3/1/2026
 */
const LOCAL_MWBE_API_BASE_URL = "http://localhost:3000"
const PRODUCTION_MWBE_API_BASE_URL = "https://srprojmwbe.fly.dev"
const LOCAL_BACKEND_API_BASE_URL = "http://localhost:5000"
const PRODUCTION_BACKEND_API_BASE_URL = "https://backend-bitter-morning-1805.fly.dev"

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "")
}

function resolveMwbeApiBaseUrl() {
  const explicitBaseUrl = normalizeBaseUrl(
    import.meta.env.VITE_MWBE_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ""
  )

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const apiTarget = import.meta.env.VITE_API_TARGET?.trim().toLowerCase()

  if (apiTarget === "local") {
    return normalizeBaseUrl(
      import.meta.env.VITE_MWBE_API_LOCAL_BASE_URL ||
      import.meta.env.VITE_API_LOCAL_BASE_URL ||
      LOCAL_MWBE_API_BASE_URL
    )
  }

  return normalizeBaseUrl(
    import.meta.env.VITE_MWBE_API_PRODUCTION_BASE_URL ||
    import.meta.env.VITE_API_PRODUCTION_BASE_URL ||
    PRODUCTION_MWBE_API_BASE_URL
  )
}

function resolveBackendApiBaseUrl() {
  const explicitBaseUrl = normalizeBaseUrl(
    import.meta.env.VITE_BACKEND_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    ""
  )

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const apiTarget = import.meta.env.VITE_API_TARGET?.trim().toLowerCase()

  if (apiTarget === "local") {
    return normalizeBaseUrl(
      import.meta.env.VITE_BACKEND_API_LOCAL_BASE_URL ||
      LOCAL_BACKEND_API_BASE_URL
    )
  }

  return normalizeBaseUrl(
    import.meta.env.VITE_BACKEND_API_PRODUCTION_BASE_URL ||
    PRODUCTION_BACKEND_API_BASE_URL
  )
}

const MWBE_API_BASE_URL = resolveMwbeApiBaseUrl()
const BACKEND_API_BASE_URL = resolveBackendApiBaseUrl()
const API_BASE_URL = MWBE_API_BASE_URL

export { API_BASE_URL, BACKEND_API_BASE_URL, MWBE_API_BASE_URL }
