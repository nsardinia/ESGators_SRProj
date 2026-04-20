/**
 * Test coverage for API utility logic.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */

describe("api", () => {
  const originalEnv = {
    VITE_API_TARGET: import.meta.env.VITE_API_TARGET,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_MWBE_API_BASE_URL: import.meta.env.VITE_MWBE_API_BASE_URL,
    VITE_API_LOCAL_BASE_URL: import.meta.env.VITE_API_LOCAL_BASE_URL,
    VITE_MWBE_API_LOCAL_BASE_URL: import.meta.env.VITE_MWBE_API_LOCAL_BASE_URL,
    VITE_API_PRODUCTION_BASE_URL: import.meta.env.VITE_API_PRODUCTION_BASE_URL,
    VITE_MWBE_API_PRODUCTION_BASE_URL: import.meta.env.VITE_MWBE_API_PRODUCTION_BASE_URL,
    VITE_BACKEND_API_BASE_URL: import.meta.env.VITE_BACKEND_API_BASE_URL,
    VITE_BACKEND_URL: import.meta.env.VITE_BACKEND_URL,
    VITE_BACKEND_API_LOCAL_BASE_URL: import.meta.env.VITE_BACKEND_API_LOCAL_BASE_URL,
    VITE_BACKEND_API_PRODUCTION_BASE_URL: import.meta.env.VITE_BACKEND_API_PRODUCTION_BASE_URL,
  }

  async function loadApiModule() {
    vi.resetModules()
    return import("@/lib/api")
  }

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it("prefers explicit base URLs and trims a trailing slash", async () => {
    Object.assign(import.meta.env, {
      VITE_MWBE_API_BASE_URL: "https://mwbe.example.test/",
      VITE_BACKEND_API_BASE_URL: "https://backend.example.test/",
      VITE_API_TARGET: "",
    })

    const api = await loadApiModule()

    expect(api.MWBE_API_BASE_URL).toBe("https://mwbe.example.test")
    expect(api.API_BASE_URL).toBe("https://mwbe.example.test")
    expect(api.BACKEND_API_BASE_URL).toBe("https://backend.example.test")
  })

  it("falls back to the local URLs when the API target is local", async () => {
    Object.assign(import.meta.env, {
      VITE_MWBE_API_BASE_URL: "",
      VITE_API_BASE_URL: "",
      VITE_BACKEND_API_BASE_URL: "",
      VITE_BACKEND_URL: "",
      VITE_API_TARGET: "local",
      VITE_MWBE_API_LOCAL_BASE_URL: "http://mwbe.local:3001/",
      VITE_BACKEND_API_LOCAL_BASE_URL: "http://backend.local:5001/",
    })

    const api = await loadApiModule()

    expect(api.API_BASE_URL).toBe("http://mwbe.local:3001")
    expect(api.BACKEND_API_BASE_URL).toBe("http://backend.local:5001")
  })

  it("adds a bearer token for authenticated requests", async () => {
    const api = await loadApiModule()
    const user = {
      getIdToken: vi.fn(async () => "token-123"),
    }

    await expect(
      api.getAuthHeaders(user, { "Content-Type": "application/json" })
    ).resolves.toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    })
  })
})
