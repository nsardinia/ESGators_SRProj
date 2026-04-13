import { render, waitFor } from "@testing-library/react"
import RegisteredDeviceSync from "./RegisteredDeviceSync"

const { mockGet, mockRef } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRef: vi.fn((database, path) => ({ database, path })),
}))

vi.mock("firebase/database", () => ({
  get: (...args) => mockGet(...args),
  ref: (...args) => mockRef(...args),
}))

vi.mock("../lib/firebase-database", () => ({
  database: { name: "test-database" },
}))

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
    mockGet.mockReset()
    mockRef.mockClear()
  })

  it("syncs Firebase telemetry using the same direct RTDB reads as Node Map", async () => {
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

    mockGet.mockResolvedValue({
      val: () => ({
        sht30: {
          latest: {
            deviceId: "node-1",
            temperatureC: 23.4,
            humidityPct: 48.2,
            updatedAtMs: 1712970001000,
          },
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

    expect(syncCall).toMatchObject({
      method: "POST",
    })
    expect(mockRef).toHaveBeenCalledWith(
      { name: "test-database" },
      "users/owner-123/devices/node-1"
    )

    expect(JSON.parse(syncCall.body)).toEqual({
      source: "firebase-rtdb",
      samples: [
        {
          sensor_id: "node-1",
          metric_type: "temperature",
          value: 23.4,
          timestamp: 1712970001000,
          owner_uid: "owner-123",
          owner_email: "owner@example.com",
          device_name: "North greenhouse sensor",
        },
        {
          sensor_id: "node-1",
          metric_type: "humidity",
          value: 48.2,
          timestamp: 1712970001000,
          owner_uid: "owner-123",
          owner_email: "owner@example.com",
          device_name: "North greenhouse sensor",
        },
      ],
    })
    expect(syncCall.headers.Authorization).toBe("Bearer firebase-id-token")

    unmount()
  })
})
