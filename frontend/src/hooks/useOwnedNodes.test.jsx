import { renderHook, waitFor } from "@testing-library/react"
import useOwnedNodes from "./useOwnedNodes"

const { mockGetDatabase, mockOnValue, mockRef } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(() => ({ name: "test-database" })),
  mockOnValue: vi.fn(),
  mockRef: vi.fn((database, path) => ({ database, path })),
}))

vi.mock("../lib/firebase-core", () => ({
  firebaseApp: { name: "test-app" },
}))

vi.mock("firebase/database", () => ({
  getDatabase: (...args) => mockGetDatabase(...args),
  onValue: (...args) => mockOnValue(...args),
  ref: (...args) => mockRef(...args),
}))

describe("useOwnedNodes", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    mockOnValue.mockReset()
    mockRef.mockClear()
    mockGetDatabase.mockClear()
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

    mockOnValue.mockImplementation((reference, handleValue, handleError) => {
      handleError(new Error("Permission denied"))
      return vi.fn()
    })

    const user = {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
      getIdToken: vi.fn(async () => "test-token"),
    }

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

  it("normalizes nested latest telemetry for real devices", async () => {
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

    mockOnValue.mockImplementation((reference, handleValue) => {
      handleValue({
        val: () => ({
          latest: {
            status: "online",
            updatedAt: "2026-04-12T14:20:00.000Z",
            temperatureC: 24.6,
            humidityPct: 51.2,
            batteryVolts: 3.87,
          },
        }),
      })
      return vi.fn()
    })

    const user = {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
      getIdToken: vi.fn(async () => "test-token"),
    }

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes[0]?.telemetry?.temperatureC).toBe(24.6)
    })

    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-1",
      status: "online",
      updatedAtMs: Date.parse("2026-04-12T14:20:00.000Z"),
      telemetry: {
        temperatureC: 24.6,
        humidityPct: 51.2,
        status: "online",
        updatedAtMs: Date.parse("2026-04-12T14:20:00.000Z"),
      },
    })
  })

  it("normalizes telemetry from nested hardware sensor buckets", async () => {
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
                deviceId: "node-2",
                name: "Field sensor",
                description: "Real hardware payload shape",
                status: "claimed",
              },
            ],
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

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

    const user = {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
      getIdToken: vi.fn(async () => "test-token"),
    }

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes[0]?.telemetry?.soundLevel).toBe(57.6)
    })

    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-2",
      status: "online",
      updatedAtMs: Date.parse("2026-04-12T15:45:00.000Z"),
      telemetry: {
        temperatureC: 23.8,
        humidityPct: 49.4,
        no2: 18.2,
        soundLevel: 57.6,
        status: "online",
      },
    })
  })

  it("does not treat subscription time as the last update when telemetry has no timestamp", async () => {
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
                deviceId: "node-3",
                name: "Timestamp-free node",
                description: "Reports sensor values without a recorded time",
                status: "claimed",
              },
            ],
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    mockOnValue.mockImplementation((reference, handleValue) => {
      handleValue({
        val: () => ({
          sht30: {
            latest: {
              temperatureC: 22.1,
              humidityPct: 46.8,
            },
          },
          sound: {
            latest: {
              raw: 54.2,
            },
          },
        }),
      })
      return vi.fn()
    })

    const user = {
      uid: "firebase-user-1",
      email: "owner@example.com",
      displayName: "Owner",
      getIdToken: vi.fn(async () => "test-token"),
    }

    const { result } = renderHook(() => useOwnedNodes(user))

    await waitFor(() => {
      expect(result.current.createdNodes[0]?.telemetry?.temperatureC).toBe(22.1)
    })

    expect(result.current.createdNodes[0]).toMatchObject({
      id: "node-3",
      status: "claimed",
      updatedAtMs: null,
      telemetry: {
        temperatureC: 22.1,
        humidityPct: 46.8,
        soundLevel: 54.2,
        updatedAtMs: null,
      },
    })
  })
})
