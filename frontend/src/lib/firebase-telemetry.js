const FIREBASE_TIMESTAMP_MIN_SECONDS = 946684800
const FIREBASE_TIMESTAMP_MIN_MS = FIREBASE_TIMESTAMP_MIN_SECONDS * 1000

const FIREBASE_TELEMETRY_BUCKETS = ["sht30", "no2", "sound", "pms5003", "air_quality"]
const FIREBASE_SENSOR_MAPPINGS = [
  { bucket: "sht30", field: "temperatureC", metric_type: "temperature" },
  { bucket: "sht30", field: "humidityPct", metric_type: "humidity" },
  { bucket: "no2", field: "raw", metric_type: "no2" },
  { bucket: "sound", field: "raw", metric_type: "noise_levels" },
  { bucket: "air_quality", field: "raw", metric_type: "air_quality" },
  { bucket: "pms5003", field: "aqi", metric_type: "air_quality" },
  { bucket: "pms5003", field: "airQuality", metric_type: "air_quality" },
]

function normalizeFirebaseTimestamp(rawTimestamp, fallbackTimestamp = Date.now()) {
  const numeric = Number(rawTimestamp)

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.trunc(fallbackTimestamp)
  }

  if (numeric >= FIREBASE_TIMESTAMP_MIN_MS) {
    return Math.trunc(numeric)
  }

  if (numeric >= FIREBASE_TIMESTAMP_MIN_SECONDS) {
    return Math.trunc(numeric * 1000)
  }

  return Math.trunc(fallbackTimestamp)
}

function normalizeTelemetryPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  if (!FIREBASE_TELEMETRY_BUCKETS.some((bucket) => payload?.[bucket]?.latest)) {
    const updatedAtMs = Number.isFinite(Number(payload.updatedAtMs ?? payload.timestamp ?? payload.recordedAt))
      ? normalizeFirebaseTimestamp(payload.updatedAtMs ?? payload.timestamp ?? payload.recordedAt)
      : null
    const normalizedStatus = String(payload.status || "").trim()
    const temperatureC = payload.temperatureC ?? null
    const humidityPct = payload.humidityPct ?? null
    const batteryVolts = payload.batteryVolts ?? null
    const no2Raw = payload.no2Raw ?? payload.raw ?? null
    const soundRaw = payload.soundRaw ?? null
    const particulateMatterLevel = payload.particulateMatterLevel ?? null
    const airQuality = payload.airQuality ?? particulateMatterLevel ?? null
    const hasFlatTelemetry = [
      temperatureC,
      humidityPct,
      batteryVolts,
      no2Raw,
      soundRaw,
      airQuality,
      particulateMatterLevel,
      updatedAtMs,
      normalizedStatus,
    ].some((value) => value !== null && value !== "")

    if (!hasFlatTelemetry) {
      return null
    }

    return {
      temperatureC,
      humidityPct,
      batteryVolts,
      no2Raw,
      soundRaw,
      airQuality,
      particulateMatterLevel,
      updatedAtMs,
      status: normalizedStatus,
    }
  }

  const latestReadings = FIREBASE_TELEMETRY_BUCKETS
    .map((bucket) => payload?.[bucket]?.latest)
    .filter(Boolean)

  if (latestReadings.length === 0) {
    return null
  }

  const updatedAtCandidates = latestReadings
    .map((reading) =>
      normalizeFirebaseTimestamp(
        reading?.updatedAtMs ?? reading?.timestamp ?? reading?.recordedAt
      )
    )
    .filter((value) => Number.isFinite(value))

  return {
    temperatureC: payload?.sht30?.latest?.temperatureC ?? null,
    humidityPct: payload?.sht30?.latest?.humidityPct ?? null,
    batteryVolts: payload?.sht30?.latest?.batteryVolts ?? null,
    no2Raw: payload?.no2?.latest?.raw ?? null,
    soundRaw: payload?.sound?.latest?.raw ?? null,
    airQuality:
      payload?.air_quality?.latest?.raw
      ?? payload?.pms5003?.latest?.aqi
      ?? payload?.pms5003?.latest?.airQuality
      ?? null,
    particulateMatterLevel:
      payload?.pms5003?.latest?.pm25
      ?? payload?.pms5003?.latest?.particulateMatterLevel
      ?? null,
    updatedAtMs:
      updatedAtCandidates.length > 0
        ? Math.max(...updatedAtCandidates)
        : null,
    status:
      latestReadings.find((reading) => String(reading?.status || "").trim())?.status
      || "",
  }
}

function normalizeFirebaseDevicePayload(deviceId, payload, now = Date.now()) {
  const defaultSensorId = String(
    deviceId
    || payload?.sht30?.latest?.deviceId
    || payload?.no2?.latest?.deviceId
    || payload?.sound?.latest?.deviceId
    || payload?.pms5003?.latest?.deviceId
    || payload?.air_quality?.latest?.deviceId
    || ""
  ).trim()

  const samples = []

  FIREBASE_SENSOR_MAPPINGS.forEach((mapping) => {
    const latest = payload?.[mapping.bucket]?.latest

    if (!latest) {
      return
    }

    const numericValue = Number(latest?.[mapping.field])

    if (!Number.isFinite(numericValue)) {
      return
    }

    const sensorId = String(latest.deviceId || defaultSensorId || "").trim()

    if (!sensorId) {
      return
    }

    samples.push({
      sensor_id: sensorId,
      metric_type: mapping.metric_type,
      value: numericValue,
      timestamp: normalizeFirebaseTimestamp(
        latest.updatedAtMs ?? latest.timestamp ?? latest.recordedAt,
        now
      ),
    })
  })

  return samples
}

function createSampleFingerprint(sample) {
  const metricType = String(sample?.metric_type || "").trim().toLowerCase()
  const numericValue = Number(sample?.value)

  if (!Number.isFinite(numericValue)) {
    return "nan"
  }

  if (metricType === "temperature" || metricType === "humidity") {
    return numericValue.toFixed(2)
  }

  return numericValue.toFixed(0)
}

export {
  createSampleFingerprint,
  normalizeFirebaseDevicePayload,
  normalizeFirebaseTimestamp,
  normalizeTelemetryPayload,
}
