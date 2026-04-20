/**
 * Test coverage for owned-node hook. 
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { renderHook, waitFor } from "@testing-library/react"
import useOwnedNodes from "@/hooks/useOwnedNodes"

const { mockOnValue, mockRef } = vi.hoisted(() => ({
  mockOnValue: vi.fn(),
  mockRef: vi.fn((database, path) => ({ database, path })),
}))

vi.mock("@/lib/firebase-core", () => ({
  firebaseApp: { name: "test-app" },
}))

vi.mock("@/lib/firebase-database", () => ({
  database: { name: "test-database" },
}))

vi.mock("firebase/database", () => ({
  onValue: (...args) => mockOnValue(...args),
  ref: (...args) => mockRef(...args),
}))

describe("useOwnedNodes", () => {
  const originalFetch = global.fetch
  const user = {
    uid: "firebase-user-1",
    email: "owner@example.com",
    displayName: "Owner",
    getIdToken: vi.fn(async () => "test-token"),
  }

  afterEach(() => {
    global.fetch = originalFetch
    mockOnValue.mockReset()
    mockRef.mockClear()
  })

  function mockOwnedNodeRequests() {
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

      if (normalizedUrl.includes("/devices/owned")) {
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
  }

  it("keeps device cards visible when live telemetry cannot be read", async () => {
    mockOwnedNodeRequests()

    // This simulates Firebase permission trouble after the owned device list
    // has already loaded from the API.
    mockOnValue.mockImplementation((reference, handleValue, handleError) => {
      handleError(new Error("Permission denied"))
      return vi.fn()
    })

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes).toHaveLength(1)
    })

    await waitFor(() => {
      expect(result.current.warning).toMatch(/live telemetry is unavailable/i)
    })

    expect(mockRef).toHaveBeenCalledWith(
      { name: "test-database" },
      "users/owner-123/devices/node-1"
    )
    expect(result.current.error).toBe("")
    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-1",
      name: "North greenhouse sensor",
      status: "claimed",
      telemetry: null,
    })
  })

  it("normalizes nested telemetry into the fields the UI consumes", async () => {
    mockOwnedNodeRequests()

    // This mirrors a hardware payload where sensor readings live inside
    // nested buckets rather than at the top level.
    mockOnValue.mockImplementation((reference, handleValue) => {
      handleValue({
        val: () => ({
          latest: {
            updatedAt: "2026-04-12T15:45:00.000Z",
            status: "online",
          },
          sht30: {
            latest: {
              temperatureC: 23.8,
              humidityPct: 49.4,
            },
          },
          no2: {
            latest: {
              raw: 18.2,
            },
          },
          sound: {
            latest: {
              raw: 57.6,
            },
          },
        }),
      })
      return vi.fn()
    })

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes[0]?.telemetry?.temperatureC).toBe(23.8)
    })

    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-1",
      status: "online",
      updatedAtMs: Date.parse("2026-04-12T15:45:00.000Z"),
      telemetry: {
        temperatureC: 23.8,
        humidityPct: 49.4,
        no2: 18.2,
        soundLevel: 57.6,
        status: "online",
        updatedAtMs: Date.parse("2026-04-12T15:45:00.000Z"),
      },
    })
  })

  it("surfaces an error when owned nodes cannot be loaded", async () => {
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

      if (normalizedUrl.includes("/devices/owned")) {
        return {
          ok: false,
          json: async () => ({
            message: "Backend device load failed",
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.error).toMatch(/backend device load failed/i)
    })

    expect(result.current.createdNodes).toEqual([])
    expect(result.current.loadingNodes).toBe(false)
  })
})
