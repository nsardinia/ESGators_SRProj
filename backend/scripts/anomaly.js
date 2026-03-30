require("dotenv").config()

const fs = require("node:fs")
const path = require("node:path")

const argv = process.argv.slice(2)

const THRESHOLDS_PATH = path.resolve(__dirname, "../sensor-thresholds.json")
const DEFAULT_THRESHOLD_DEFINITIONS = JSON.parse(fs.readFileSync(THRESHOLDS_PATH, "utf8"))

const METRIC_TYPES = Object.keys(DEFAULT_THRESHOLD_DEFINITIONS)

function parseArgs(args) {
  const parsed = {}

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]

    if (!token.startsWith("--")) {
      continue
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.slice(2).split("=")
      parsed[rawKey] = rest.join("=")
      continue
    }

    const key = token.slice(2)
    const next = args[index + 1]

    if (!next || next.startsWith("--")) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    index += 1
  }

  return parsed
}

const cli = parseArgs(argv)

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function resolveBaseUrl() {
  const target = String(cli.target || process.env.DUMMY_TARGET || "").toLowerCase()

  if (cli["send-url"]) {
    return String(cli["send-url"])
  }

  if (cli["base-url"]) {
    return String(cli["base-url"])
  }

  if (target === "fly") {
    return "https://backend-bitter-morning-1805.fly.dev" || process.env.DUMMY_BASE_URL || "http://localhost:5000"
  }

  if (target === "local") {
    return process.env.DUMMY_BASE_URL_LOCAL || process.env.DUMMY_BASE_URL || "http://localhost:5000"
  }

  return process.env.DUMMY_BASE_URL || process.env.DUMMY_BASE_URL_LOCAL || "http://localhost:5000"
}

const BASE_URL = resolveBaseUrl()
const BATCH_ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/iot/data/batch`

const INPUT_MODE = String(cli["input-mode"] || process.env.ANOMALY_INPUT_MODE || "random").toLowerCase()
const INPUT_URL = String(cli["input-url"] || process.env.ANOMALY_INPUT_URL || "")
const INPUT_METHOD = String(cli["input-method"] || process.env.ANOMALY_INPUT_METHOD || "GET").toUpperCase()
const INPUT_RESPONSE_PATH = String(cli["response-path"] || process.env.ANOMALY_RESPONSE_PATH || "")
const INPUT_SENSOR_ID_FIELD = String(cli["sensor-id-field"] || process.env.ANOMALY_SENSOR_ID_FIELD || "sensor_id")
const INPUT_METRIC_FIELD = String(cli["metric-field"] || process.env.ANOMALY_METRIC_FIELD || "metric_type")
const INPUT_VALUE_FIELD = String(cli["value-field"] || process.env.ANOMALY_VALUE_FIELD || "value")
const INPUT_TIMESTAMP_FIELD = String(cli["timestamp-field"] || process.env.ANOMALY_TIMESTAMP_FIELD || "timestamp")
const INPUT_HEADERS = (() => {
  const raw = cli["input-headers"] || process.env.ANOMALY_INPUT_HEADERS_JSON
  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse input headers JSON: ${error.message}`)
  }
})()

const REQUEST_COUNT = toNumber(
  cli.count,
  toNumber(process.env.ANOMALY_REQUEST_COUNT, 5)
)

const INTERVAL_SECONDS = toNumber(
  cli.interval,
  toNumber(
    process.env.ANOMALY_INTERVAL_SECONDS,
    process.env.ANOMALY_INTERVAL_MS ? Number(process.env.ANOMALY_INTERVAL_MS) / 1000 : 5
  )
)

const INTERVAL_MS = Math.round(INTERVAL_SECONDS * 1000)
const PAYLOAD_COUNT = toNumber(cli["payload-count"], toNumber(process.env.ANOMALY_COUNT, 1))
const SEVERITY = String(cli.severity || process.env.ANOMALY_SEVERITY || "warning").toLowerCase()
const DIRECTION = String(cli.direction || process.env.ANOMALY_DIRECTION || "high").toLowerCase()
const SOURCE = String(cli.source || process.env.ANOMALY_SOURCE || "anomaly-script")
const SENSOR_PREFIX = String(cli["sensor-prefix"] || process.env.ANOMALY_SENSOR_PREFIX || "dummy-sensor")
const METRIC_TYPE_ARG = String(cli["metric-type"] || process.env.ANOMALY_METRIC_TYPE || "all").toLowerCase()
const PATTERN = String(cli.pattern || process.env.ANOMALY_PATTERN || "normal,anomaly")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomInRange(min, max) {
  const safeMin = Number(min)
  const safeMax = Number(max)
  return Number((Math.random() * (safeMax - safeMin) + safeMin).toFixed(2))
}

function createRuntimeThresholds() {
  return {
    air_quality: { min: 0, max: 100, warningMax: 150, criticalMax: 150 },
    no2: { min: 0, max: 100, warningMax: 150, criticalMax: 150 },
    temperature: { min: 18, max: 28, criticalMin: 18, warningMax: 35, criticalMax: 35 },
    humidity: { min: 30, max: 60, criticalMin: 30, warningMax: 80, criticalMax: 80 },
    noise_levels: { min: 0, max: 75, warningMax: 90, criticalMax: 90 },
  }
}

function chooseRangeValue(range, options = {}) {
  const epsilon = options.epsilon ?? 0.01
  const lowerBound = range.min === null || range.min === undefined
    ? Number(options.fallbackMin)
    : Number(range.min) + (options.exclusiveMin ? epsilon : 0)
  const upperBound = range.max === null || range.max === undefined
    ? Number(options.fallbackMax)
    : Number(range.max) - (options.exclusiveMax ? epsilon : 0)

  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    throw new Error("Threshold range is not finite")
  }

  if (lowerBound >= upperBound) {
    return Number(lowerBound.toFixed(2))
  }

  return randomInRange(lowerBound, upperBound)
}

function getByPath(payload, dotPath) {
  if (!dotPath) {
    return payload
  }

  return String(dotPath)
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => (current == null ? current : current[segment]), payload)
}

function loadThresholdDefinitions() {
  return DEFAULT_THRESHOLD_DEFINITIONS
}

function resolveMetricTypes() {
  if (METRIC_TYPE_ARG === "all") {
    return METRIC_TYPES
  }

  if (!METRIC_TYPES.includes(METRIC_TYPE_ARG)) {
    throw new Error(`--metric-type must be one of: all, ${METRIC_TYPES.join(", ")}`)
  }

  return [METRIC_TYPE_ARG]
}

function createAnomalyValue(metricType, thresholdDefinitions, runtimeThresholds) {
  const threshold = thresholdDefinitions[metricType]
  const runtimeThreshold = runtimeThresholds[metricType]

  if (!threshold || !runtimeThreshold) {
    throw new Error(`Missing threshold definition for ${metricType}`)
  }

  if (DIRECTION === "low") {
    if (SEVERITY === "warning" && threshold.warningRangeLow) {
      return chooseRangeValue(threshold.warningRangeLow, {
        fallbackMin: threshold.warningRangeLow.min,
        fallbackMax: threshold.warningRangeLow.max,
        exclusiveMax: true,
      })
    }

    if (threshold.criticalRangeLow) {
      return chooseRangeValue(threshold.criticalRangeLow, {
        fallbackMin: runtimeThreshold.min - Math.max(runtimeThreshold.max - runtimeThreshold.min, 1) * 0.3,
        fallbackMax: Number(threshold.criticalRangeLow.max) - 0.01,
        exclusiveMax: true,
      })
    }

    throw new Error(`${metricType} does not define a low anomaly range`)
  }

  if (DIRECTION !== "high") {
    throw new Error("--direction must be either high or low")
  }

  if (SEVERITY === "warning") {
    const warningRange = threshold.warningRange || threshold.warningRangeHigh

    if (!warningRange) {
      throw new Error(`${metricType} does not define a warning range`)
    }

    return chooseRangeValue(warningRange, {
      fallbackMin: runtimeThreshold.max + 0.01,
      fallbackMax: warningRange.max,
      exclusiveMin: true,
      exclusiveMax: warningRange.max !== null,
    })
  }

  const criticalRange = threshold.criticalRange || threshold.criticalRangeHigh

  if (!criticalRange) {
    throw new Error(`${metricType} does not define a critical range`)
  }

  return chooseRangeValue(criticalRange, {
    fallbackMin: Number(criticalRange.min) + 0.01,
    fallbackMax: Number(criticalRange.min) + Math.max(runtimeThreshold.max - runtimeThreshold.min, 1) * 0.3,
    exclusiveMin: true,
  })
}

function createNormalValue(metricType, thresholdDefinitions) {
  const threshold = thresholdDefinitions[metricType]

  if (!threshold?.normalRange) {
    throw new Error(`${metricType} does not define a normal range`)
  }

  return chooseRangeValue(threshold.normalRange, {
    fallbackMin: threshold.normalRange.min,
    fallbackMax: threshold.normalRange.max,
  })
}

function resolvePhase(iteration) {
  const phase = PATTERN[(iteration - 1) % PATTERN.length]

  if (!["normal", "anomaly"].includes(phase)) {
    throw new Error("--pattern entries must be either normal or anomaly")
  }

  return phase
}

function summarizeSamples(samples) {
  return samples
    .map((sample) => `${sample.metric_type}=${sample.value}`)
    .join(", ")
}

async function ensureSendTargetReachable() {
  try {
    const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/`, {
      method: "GET",
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch (error) {
    throw new Error(
      `Send target is not reachable at ${BASE_URL}. Start backend or pass --send-url/--base-url. Original error: ${error.message}`
    )
  }
}

function createGeneratedSamples(phase, thresholdDefinitions, runtimeThresholds, metricTypes, timestamp) {
  const samples = []

  for (let sensorIndex = 1; sensorIndex <= PAYLOAD_COUNT; sensorIndex += 1) {
    const sensorId = `${SENSOR_PREFIX}-${sensorIndex}`

    for (const metricType of metricTypes) {
      samples.push({
        sensor_id: sensorId,
        metric_type: metricType,
        value: phase === "normal"
          ? createNormalValue(metricType, thresholdDefinitions)
          : createAnomalyValue(metricType, thresholdDefinitions, runtimeThresholds),
        timestamp,
      })
    }
  }

  return samples
}

function normalizeRemoteSamples(payload, timestamp) {
  const rawItems = getByPath(payload, INPUT_RESPONSE_PATH)
  const items = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === "object"
      ? [rawItems]
      : Array.isArray(payload)
        ? payload
        : []

  return items
    .map((item, index) => ({
      sensor_id: item?.[INPUT_SENSOR_ID_FIELD] || `${SENSOR_PREFIX}-${index + 1}`,
      metric_type: String(item?.[INPUT_METRIC_FIELD] ?? "").toLowerCase(),
      value: Number(item?.[INPUT_VALUE_FIELD]),
      timestamp: Number.isFinite(Number(item?.[INPUT_TIMESTAMP_FIELD]))
        ? Number(item?.[INPUT_TIMESTAMP_FIELD])
        : timestamp,
    }))
    .filter((sample) => sample.sensor_id && METRIC_TYPES.includes(sample.metric_type) && Number.isFinite(sample.value))
}

async function loadRemoteSamples(timestamp) {
  if (!INPUT_URL) {
    throw new Error("--input-url is required when --input-mode remote")
  }

  const response = await fetch(INPUT_URL, {
    method: INPUT_METHOD,
    headers: INPUT_HEADERS,
  })

  const text = await response.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!response.ok) {
    throw new Error(`Remote input request failed (${response.status}): ${JSON.stringify(body)}`)
  }

  const samples = normalizeRemoteSamples(body, timestamp)

  if (samples.length === 0) {
    throw new Error("Remote input returned no valid samples")
  }

  return samples
}

async function buildSamples(iteration, thresholdDefinitions, runtimeThresholds, metricTypes, timestamp) {
  const phase = resolvePhase(iteration)

  if (INPUT_MODE === "remote") {
    const samples = await loadRemoteSamples(timestamp)
    return { phase, samples }
  }

  if (INPUT_MODE !== "random") {
    throw new Error("--input-mode must be either random or remote")
  }

  return {
    phase,
    samples: createGeneratedSamples(phase, thresholdDefinitions, runtimeThresholds, metricTypes, timestamp),
  }
}

async function pushOnce(iteration, thresholdDefinitions, runtimeThresholds, metricTypes) {
  const startedAt = new Date().toISOString()
  const timestamp = Date.now()
  const { phase, samples } = await buildSamples(
    iteration,
    thresholdDefinitions,
    runtimeThresholds,
    metricTypes,
    timestamp
  )

  const response = await fetch(BATCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: SOURCE,
      samples,
    }),
  })

  const text = await response.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!response.ok) {
    throw new Error(
      `Request ${iteration}/${REQUEST_COUNT} failed (${response.status}): ${JSON.stringify(body)}`
    )
  }

  console.log(
    `[${startedAt}] ${iteration}/${REQUEST_COUNT} pushed, mode=${INPUT_MODE}, phase=${phase}, samples=${body?.accepted ?? samples.length}, esg=${body?.esg?.overall ?? "n/a"}, values=[${summarizeSamples(samples)}]`
  )
}

async function run() {
  if (!Number.isInteger(REQUEST_COUNT) || REQUEST_COUNT < 1) {
    throw new Error("--count must be an integer >= 1")
  }

  if (!Number.isFinite(INTERVAL_SECONDS) || INTERVAL_SECONDS < 0) {
    throw new Error("--interval must be a number >= 0")
  }

  if (!Number.isInteger(PAYLOAD_COUNT) || PAYLOAD_COUNT < 1) {
    throw new Error("--payload-count must be an integer >= 1")
  }

  if (!["warning", "critical"].includes(SEVERITY)) {
    throw new Error("--severity must be either warning or critical")
  }

  if (PATTERN.length === 0) {
    throw new Error("--pattern must include at least one phase")
  }

  const thresholdDefinitions = loadThresholdDefinitions()
  const runtimeThresholds = createRuntimeThresholds()
  const metricTypes = resolveMetricTypes()

  await ensureSendTargetReachable()

  console.log(`Start pushing anomaly test data to ${BATCH_ENDPOINT}`)
  console.log(
    `Schedule: ${REQUEST_COUNT} times, every ${INTERVAL_SECONDS}s | input-mode=${INPUT_MODE}, payload-count=${PAYLOAD_COUNT}, metric-type=${metricTypes.join(",")}, pattern=${PATTERN.join("->")}, anomaly-severity=${SEVERITY}, direction=${DIRECTION}`
  )

  for (let iteration = 1; iteration <= REQUEST_COUNT; iteration += 1) {
    try {
      await pushOnce(iteration, thresholdDefinitions, runtimeThresholds, metricTypes)
    } catch (error) {
      console.error(error.message)
    }

    if (iteration < REQUEST_COUNT) {
      await delay(INTERVAL_MS)
    }
  }

  console.log("Finished anomaly test schedule.")
}

run().catch((error) => {
  console.error("Fatal error:", error.message)
  process.exit(1)
})
