/**
 * Test coverage for Firebase telemetry logic.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import {
  createSampleFingerprint,
  normalizeFirebaseDevicePayload,
  normalizeFirebaseTimestamp,
  normalizeTelemetryPayload,
} from "@/lib/firebase-telemetry"

describe("firebase telemetry", () => {
  it("normalizes Unix-second timestamps into milliseconds", () => {
    expect(normalizeFirebaseTimestamp(1_712_970_001)).toBe(1_712_970_001_000)
  })

  it("normalizes bucketed hardware payloads into a flat telemetry object", () => {
    const telemetry = normalizeTelemetryPayload({
      sht30: {
        latest: {
          temperatureC: 23.4,
          humidityPct: 48.2,
          batteryVolts: 3.87,
          updatedAtMs: 1_712_970_001_000,
          status: "online",
        },
      },
      no2: {
        latest: {
          raw: 18.2,
          updatedAtMs: 1_712_970_001_000,
        },
      },
      sound: {
        latest: {
          raw: 57.6,
          updatedAtMs: 1_712_970_001_000,
        },
      },
      pms5003: {
        latest: {
          aqi: 41,
          pm25: 12.4,
          updatedAtMs: 1_712_970_001_000,
        },
      },
    })

    expect(telemetry).toEqual({
      temperatureC: 23.4,
      humidityPct: 48.2,
      batteryVolts: 3.87,
      no2Raw: 18.2,
      soundRaw: 57.6,
      airQuality: 41,
      particulateMatterLevel: 12.4,
      updatedAtMs: 1_712_970_001_000,
      status: "online",
    })
  })

  it("builds backend samples from flat latest-wrapper payloads", () => {
    const samples = normalizeFirebaseDevicePayload("node-2", {
      latest: {
        deviceId: "node-2",
        temperatureC: 24.6,
        humidityPct: 51.2,
        no2Raw: 17.8,
        soundRaw: 54.4,
        airQuality: 39,
        updatedAt: "2026-04-12T14:20:00.000Z",
        status: "online",
      },
    })

    expect(samples).toEqual([
      {
        sensor_id: "node-2",
        metric_type: "temperature",
        value: 24.6,
        timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
      },
      {
        sensor_id: "node-2",
        metric_type: "humidity",
        value: 51.2,
        timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
      },
      {
        sensor_id: "node-2",
        metric_type: "no2",
        value: 17.8,
        timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
      },
      {
        sensor_id: "node-2",
        metric_type: "noise_levels",
        value: 54.4,
        timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
      },
      {
        sensor_id: "node-2",
        metric_type: "air_quality",
        value: 39,
        timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
      },
    ])
  })

  it("rounds sample fingerprints based on metric type", () => {
    expect(
      createSampleFingerprint({ metric_type: "temperature", value: 24.678 })
    ).toBe("24.68")
    expect(
      createSampleFingerprint({ metric_type: "noise_levels", value: 54.4 })
    ).toBe("54")
  })
})
