import { renderHook, waitFor } from "@testing-library/react"
import useOwnedNodes from "./useOwnedNodes"

const mockGet = vi.fn()
const mockRef = vi.fn((database, path) => ({ database, path }))

vi.mock("../lib/firebase", () => ({
  database: { name: "test-database" },
}))

vi.mock("firebase/database", () => ({
  get: (...args) => mockGet(...args),
  ref: (...args) => mockRef(...args),
}))

describe("useOwnedNodes", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    mockGet.mockReset()
    mockRef.mockClear()
  })

  it("keeps loaded nodes visible when Firebase telemetry cannot be read", async () => {
    global.fetch = vi.fn(async (url) => {
      const normalizedUrl = String(url)

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

      if (normalizedUrl.includes("/devices/owned?")) {
        return {
          ok: true,
          json: async () => ({
            devices: [
              {
                deviceId: "node-1",
                name: "North greenhouse sensor",
                description: "Tracks humidity and temperature",
                status: "claimed",
              },
            ],
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    mockGet.mockRejectedValue(new Error("Permission denied"))

    const user = {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
    }

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes).toHaveLength(1)
    })

    await waitFor(() => {
      expect(result.current.warning).toMatch(/live telemetry is unavailable/i)
    })

    expect(result.current.error).toBe("")
    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-1",
      name: "North greenhouse sensor",
      status: "claimed",
      telemetry: null,
    })
  })
})
