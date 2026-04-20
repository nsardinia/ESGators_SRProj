/**
 * Core regression coverage for the Firebase-to-backend bridge.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { render, waitFor } from "@testing-library/react"
import RegisteredDeviceSync from "@/components/RegisteredDeviceSync"

const { mockGet, mockRef } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRef: vi.fn((database, path) => ({ database, path })),
}))

vi.mock("firebase/database", () => ({
  get: (...args) => mockGet(...args),
  ref: (...args) => mockRef(...args),
}))

vi.mock("@/lib/firebase-database", () => ({
  database: { name: "test-database" },
}))

vi.mock("@/components/AuthContext", () => ({
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
    mockGet.mockReset()
    mockRef.mockClear()
  })

  it("uploads normalized readings for owned devices", async () => {
    const fetchCalls = []

    // The component talks to the owner sync endpoint, device inventory endpoint,
    // and finally the batch upload endpoint. We only fake those boundaries.
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

      if (normalizedUrl.endsWith("/iot/data/batch")) {
        return {
          ok: true,
          json: async () => ({
            status: "success",
            accepted: 2,
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    // This payload mirrors the "latest" wrapper shape the app already supports.
    mockGet.mockResolvedValue({
      val: () => ({
        latest: {
          deviceId: "node-1",
          temperatureC: 24.6,
          humidityPct: 51.2,
          updatedAt: "2026-04-12T14:20:00.000Z",
          status: "online",
        },
      }),
    })

    const { unmount } = render(<RegisteredDeviceSync />)

    await waitFor(() => {
      expect(
        fetchCalls.some((call) => call.url.endsWith("/iot/data/batch"))
      ).toBe(true)
    })

    const syncCall = fetchCalls.find((call) => call.url.endsWith("/iot/data/batch"))

    expect(mockRef).toHaveBeenCalledWith(
      { name: "test-database" },
      "users/owner-123/devices/node-1"
    )
    expect(syncCall).toMatchObject({
      method: "POST",
    })
    expect(syncCall.headers.Authorization).toBe("Bearer firebase-id-token")
    expect(JSON.parse(syncCall.body)).toEqual({
      source: "firebase-rtdb",
      samples: [
        {
          sensor_id: "node-1",
          metric_type: "temperature",
          value: 24.6,
          timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
          owner_uid: "owner-123",
          owner_email: "owner@example.com",
          device_name: "North greenhouse sensor",
        },
        {
          sensor_id: "node-1",
          metric_type: "humidity",
          value: 51.2,
          timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
          owner_uid: "owner-123",
          owner_email: "owner@example.com",
          device_name: "North greenhouse sensor",
        },
      ],
    })

    unmount()
  })
})
