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

function getApiBaseUrl() {
  const explicitBaseUrl = (
    import.meta.env.VITE_MWBE_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ""
  ).trim()

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const apiTarget = import.meta.env.VITE_API_TARGET?.trim().toLowerCase()

  if (apiTarget === "production") {
    return (
      import.meta.env.VITE_MWBE_API_PRODUCTION_BASE_URL?.trim() ||
      import.meta.env.VITE_API_PRODUCTION_BASE_URL?.trim() ||
      PRODUCTION_MWBE_API_BASE_URL
    )
  }

  return (
    import.meta.env.VITE_MWBE_API_LOCAL_BASE_URL?.trim() ||
    import.meta.env.VITE_API_LOCAL_BASE_URL?.trim() ||
    LOCAL_MWBE_API_BASE_URL
  )
}

function getBackendApiBaseUrl() {
  const explicitBaseUrl = (
    import.meta.env.VITE_BACKEND_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    ""
  ).trim()

  if (explicitBaseUrl) {
    return explicitBaseUrl
  }

  const apiTarget = import.meta.env.VITE_API_TARGET?.trim().toLowerCase()

  if (apiTarget === "production") {
    return (
      import.meta.env.VITE_BACKEND_API_PRODUCTION_BASE_URL?.trim() ||
      PRODUCTION_BACKEND_API_BASE_URL
    )
  }

  return (
    import.meta.env.VITE_BACKEND_API_LOCAL_BASE_URL?.trim() ||
    LOCAL_BACKEND_API_BASE_URL
  )
}

const API_BASE_URL = getApiBaseUrl()
const MWBE_API_BASE_URL = API_BASE_URL
const BACKEND_API_BASE_URL = getBackendApiBaseUrl()

export { API_BASE_URL, BACKEND_API_BASE_URL, MWBE_API_BASE_URL }
