import { render, waitFor } from "@testing-library/react"
import RegisteredDeviceSync from "./RegisteredDeviceSync"

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    user: {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
      getIdToken: vi.fn(async () => "firebase-id-token"),
    },
  }),
}))

describe("RegisteredDeviceSync", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("syncs Firebase telemetry through the owner endpoint", async () => {
    const fetchCalls = []

    global.fetch = vi.fn(async (url, options = {}) => {
      const normalizedUrl = String(url)
      fetchCalls.push({
        url: normalizedUrl,
        method: String(options.method || "GET").toUpperCase(),
        body: options.body || "",
        headers: options.headers || {},
      })

      if (normalizedUrl.endsWith("/users")) {
        return {
          ok: true,
          json: async () => ({
            user: {
              firebase_uid: "owner-123",
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/firebase/sync")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    const { unmount } = render(<RegisteredDeviceSync />)

    await waitFor(() => {
      expect(
        fetchCalls.some((call) => call.url.endsWith("/firebase/sync"))
      ).toBe(true)
    })

    const syncCall = fetchCalls.find((call) => call.url.endsWith("/firebase/sync"))

    expect(syncCall).toMatchObject({
      method: "POST",
    })
    expect(JSON.parse(syncCall.body)).toEqual({
      ownerUid: "owner-123",
    })
    expect(syncCall.headers.Authorization).toBe("Bearer firebase-id-token")

    unmount()
  })
})
