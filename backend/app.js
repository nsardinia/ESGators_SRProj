require("dotenv").config()

const express = require("express")
const cors = require("cors")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const axios = require("axios")
const protobuf = require("protobufjs")
const snappy = require("snappy")
const promClient = require("prom-client")
const { createSupabaseFromEnv } = require("./supabase")

let db = null
let firebaseAdmin = null
try {
    db = require("./firebase")
    firebaseAdmin = require("firebase-admin")
} catch (error) {
    console.warn("Firebase disabled:", error.message)
}

const METRIC_TYPES = ["air_quality", "no2", "temperature", "humidity", "noise_levels"]
const EXPORT_WINDOWS = {
    day: { label: "day", days: 1 },
    week: { label: "week", days: 7 },
    month: { label: "month", days: 30 },
}
const DEFAULT_THRESHOLDS = {
    air_quality: { min: 0, max: 100, warningMax: 150, criticalMax: 150, unit: "aqi" },
    no2: { min: 0, max: 100, warningMax: 150, criticalMax: 150, unit: "ppb" },
    temperature: { min: 18, max: 28, criticalMin: 18, warningMax: 35, criticalMax: 35, unit: "celsius" },
    humidity: { min: 30, max: 60, criticalMin: 30, warningMax: 80, criticalMax: 80, unit: "percent" },
    noise_levels: { min: 0, max: 75, warningMax: 90, criticalMax: 90, unit: "dba" },
}
const DEFAULT_FIREBASE_PROJECT_ID = "senior-project-esgators"
const DEFAULT_FIREBASE_DATABASE_URL = `https://${DEFAULT_FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
const DEFAULT_FIREBASE_DEVICE_ROOT_PATH = "users"
const FIREBASE_USER_DEVICES_PATH_SEGMENT = "devices"
const DEFAULT_MWBE_API_BASE_URL = "https://srprojmwbe.fly.dev"
const DEFAULT_FIREBASE_SYNC_INTERVAL_MS = 5000
const DEFAULT_FIREBASE_OWNER_SYNC_INTERVAL_MS = 1000
const DEFAULT_OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses"
const FIREBASE_TIMESTAMP_MIN_SECONDS = 946684800
const FIREBASE_TIMESTAMP_MIN_MS = FIREBASE_TIMESTAMP_MIN_SECONDS * 1000
const DEFAULT_KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
const DEFAULT_KALSHI_DEMO_BASE_URL = "https://demo-api.kalshi.co/trade-api/v2"
const KALSHI_MARKETS_QUERY_PARAMS = [
    "limit",
    "cursor",
    "event_ticker",
    "series_ticker",
    "min_created_ts",
    "max_created_ts",
    "min_updated_ts",
    "max_close_ts",
    "min_close_ts",
    "min_settled_ts",
    "max_settled_ts",
    "status",
    "tickers",
    "mve_filter",
]
const KALSHI_EVENTS_QUERY_PARAMS = [
    "cursor",
    "series_ticker",
    "min_close_ts",
    "min_updated_ts",
]
const KALSHI_PORTFOLIO_QUERY_PARAMS = [
    "cursor",
    "limit",
    "count_filter",
    "ticker",
    "event_ticker",
    "min_ts",
    "max_ts",
    "status",
    "subaccount",
]
const KALSHI_ORDERBOOK_QUERY_PARAMS = ["depth"]
const DEFAULT_DEVICE_OWNER_LABELS = {
    owner_uid: "unknown",
    owner_email: "unknown",
    device_name: "unknown",
}
const DEFAULT_ALLOWED_WEB_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
const FIREBASE_SENSOR_MAPPINGS = [
    { bucket: "sht30", field: "temperatureC", metric_type: "temperature" },
    { bucket: "sht30", field: "humidityPct", metric_type: "humidity" },
    { bucket: "no2", field: "raw", metric_type: "no2" },
    { bucket: "sound", field: "raw", metric_type: "noise_levels" },
    { bucket: "air_quality", field: "raw", metric_type: "air_quality" },
    { bucket: "pms5003", field: "aqi", metric_type: "air_quality" },
    { bucket: "pms5003", field: "airQuality", metric_type: "air_quality" },
]

let writeRequestTypePromise

function loadWriteRequestType() {
    if (!writeRequestTypePromise) {
        const protoPath = path.resolve(__dirname, "./remote.proto")
        writeRequestTypePromise = protobuf
            .load(protoPath)
            .then((root) => root.lookupType("prometheus.WriteRequest"))
    }

    return writeRequestTypePromise
}

function parseJsonEnv(value, fallback) {
    if (!value) {
        return fallback
    }

    try {
        return JSON.parse(value)
    } catch (error) {
        console.warn(`Failed to parse JSON env value: ${error.message}`)
        return fallback
    }
}

function parseBoolean(value, fallback = false) {
    if (value === undefined) {
        return fallback
    }

    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

function normalizeOrigin(value) {
    return String(value || "").trim().replace(/\/+$/, "")
}

function buildAllowedOrigins(...sources) {
    const configuredOrigins = sources
        .flatMap((source) => String(source || "").split(","))
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean)

    return [...new Set([...DEFAULT_ALLOWED_WEB_ORIGINS, ...configuredOrigins])]
}

function createCorsOptions() {
    const allowedOrigins = buildAllowedOrigins(
        process.env.CORS_ORIGIN,
        process.env.CORS_ORIGINS,
        process.env.FRONTEND_URL,
        process.env.FRONTEND_ORIGIN,
        process.env.APP_URL,
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""
    )
    const allowAllOrigins = [process.env.CORS_ORIGIN, process.env.CORS_ORIGINS]
        .some((value) => ["*", "true"].includes(String(value || "").trim().toLowerCase()))

    return {
        origin(origin, callback) {
            if (allowAllOrigins || !origin) {
                callback(null, true)
                return
            }

            callback(null, allowedOrigins.includes(normalizeOrigin(origin)))
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    }
}

function getBearerTokenFromHeaders(headers = {}) {
    const authorizationHeader = String(headers.authorization || "").trim()

    if (!authorizationHeader) {
        return ""
    }

    const [scheme, token] = authorizationHeader.split(" ")
    if (scheme !== "Bearer" || !token) {
        return ""
    }

    return token.trim()
}

async function verifyFirebaseUserFromRequest(req) {
    if (!firebaseAdmin) {
        return null
    }

    const token = getBearerTokenFromHeaders(req.headers)
    if (!token) {
        return null
    }

    try {
        const decodedToken = await firebaseAdmin.auth().verifyIdToken(token)

        if (!decodedToken?.uid || decodedToken.role === "device") {
            return null
        }

        return decodedToken
    } catch (error) {
        const authError = new Error("Invalid Firebase ID token")
        authError.statusCode = 401
        throw authError
    }
}

function normalizeKalshiBaseUrl(value) {
    const normalized = String(value || "").trim().replace(/\/+$/, "")
    return normalized || DEFAULT_KALSHI_BASE_URL
}

function normalizeBaseUrl(value, fallback = "") {
    const normalized = String(value || "").trim().replace(/\/+$/, "")
    return normalized || fallback
}

function getKalshiConfig() {
    const environment = String(
        process.env.KALSHI_ENVIRONMENT || process.env.KALSHI_ENV || "production"
    ).trim().toLowerCase()
    const configuredBaseUrl = String(process.env.KALSHI_API_BASE_URL || "").trim()
    const baseUrl = normalizeKalshiBaseUrl(
        configuredBaseUrl
        || (environment === "demo" || environment === "sandbox"
            ? DEFAULT_KALSHI_DEMO_BASE_URL
            : DEFAULT_KALSHI_BASE_URL)
    )
    const privateKeyPem = process.env.KALSHI_PRIVATE_KEY_PEM
        ? String(process.env.KALSHI_PRIVATE_KEY_PEM).replace(/\\n/g, "\n")
        : ""
    const privateKeyBase64 = String(
        process.env.KALSHI_PRIVATE_KEY_PEM_BASE64
        || process.env.KALSHI_PRIVATE_KEY_BASE64
        || ""
    ).trim()
    const privateKeyPath = String(process.env.KALSHI_PRIVATE_KEY_PATH || "").trim()
    const apiKeyId = String(
        process.env.KALSHI_API_KEY_ID
        || process.env.KALSHI_ACCESS_KEY
        || ""
    ).trim()
    const rawTimeoutMs = Number(process.env.KALSHI_API_TIMEOUT_MS || 10000)
    const privateKeySource = privateKeyPem
        ? "env"
        : privateKeyBase64
            ? "base64_env"
            : privateKeyPath
                ? "file"
                : "none"

    return {
        environment,
        baseUrl,
        apiKeyId,
        privateKeyPem,
        privateKeyBase64,
        privateKeyPath,
        privateKeySource,
        timeoutMs: Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 10000,
        authConfigured: Boolean(apiKeyId && (privateKeyPem || privateKeyBase64 || privateKeyPath)),
    }
}

function getPublicKalshiConfig(config = getKalshiConfig()) {
    return {
        environment: config.environment,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        authConfigured: config.authConfigured,
        hasApiKeyId: Boolean(config.apiKeyId),
        hasPrivateKey: config.privateKeySource !== "none",
        privateKeySource: config.privateKeySource,
    }
}

function loadKalshiPrivateKey(config) {
    if (config.privateKeyPem) {
        return config.privateKeyPem
    }

    if (config.privateKeyBase64) {
        return Buffer.from(config.privateKeyBase64, "base64").toString("utf8")
    }

    if (config.privateKeyPath) {
        const keyPath = path.isAbsolute(config.privateKeyPath)
            ? config.privateKeyPath
            : path.resolve(process.cwd(), config.privateKeyPath)
        return fs.readFileSync(keyPath, "utf8")
    }

    return ""
}

function createKalshiSignature(privateKey, timestamp, method, requestPath) {
    const pathWithoutQuery = String(requestPath || "").split("?")[0]
    const signer = crypto.createSign("RSA-SHA256")
    signer.update(`${timestamp}${String(method || "GET").toUpperCase()}${pathWithoutQuery}`)
    signer.end()

    return signer.sign({
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }).toString("base64")
}

function buildKalshiAuthHeaders(config, method, requestPath) {
    if (!config.authConfigured) {
        throw new Error(
            "Kalshi auth is not configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY_PEM."
        )
    }

    const timestamp = String(Date.now())
    const privateKey = loadKalshiPrivateKey(config)
    const signature = createKalshiSignature(privateKey, timestamp, method, requestPath)

    return {
        "KALSHI-ACCESS-KEY": config.apiKeyId,
        "KALSHI-ACCESS-SIGNATURE": signature,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
    }
}

function pickKalshiQueryParams(query, allowedKeys) {
    return allowedKeys.reduce((params, key) => {
        const value = query?.[key]

        if (value !== undefined && value !== "") {
            params[key] = value
        }

        return params
    }, {})
}

function buildKalshiPath(...segments) {
    return `/${segments
        .map((segment) => String(segment || "").trim().replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`
}

function normalizeKalshiCategory(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\s+/g, " ")
}

function normalizeKalshiStatus(value) {
    const normalized = String(value || "").trim().toLowerCase()

    if (normalized === "active") {
        return "open"
    }

    return normalized
}

function matchesKalshiMarketStatus(market, requestedStatus) {
    const normalizedRequestedStatus = normalizeKalshiStatus(requestedStatus)

    if (!normalizedRequestedStatus) {
        return true
    }

    const normalizedMarketStatus = normalizeKalshiStatus(market?.status)

    if (normalizedRequestedStatus === "open") {
        return normalizedMarketStatus === "open" || normalizedMarketStatus === "active"
    }

    return normalizedMarketStatus === normalizedRequestedStatus
}

function extractKalshiEventMarkets(events, requestedStatus = "") {
    const seenTickers = new Set()

    return (Array.isArray(events) ? events : []).flatMap((event) => {
        const nestedMarkets = Array.isArray(event?.markets) ? event.markets : []

        return nestedMarkets
            .filter((market) => market?.ticker && !seenTickers.has(market.ticker))
            .filter((market) => matchesKalshiMarketStatus(market, requestedStatus))
            .map((market) => {
                seenTickers.add(market.ticker)

                return {
                    ...market,
                    category: market?.category || event?.category,
                    event_ticker: market?.event_ticker || event?.event_ticker,
                    series_ticker: market?.series_ticker || event?.series_ticker,
                }
            })
    })
}

function formatKalshiError(error) {
    const status = Number(error?.response?.status)
    const responseBody = error?.response?.data
    const detail = responseBody
        ? (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody))
        : error.message
    const isMissingAuth = String(error?.message || "").includes("Kalshi auth is not configured")

    return {
        statusCode: isMissingAuth
            ? 503
            : Number.isFinite(status) && status >= 400
                ? status
                : 500,
        detail,
    }
}

function parseKalshiPriceToCents(value) {
    const numericValue = Number(value)

    if (!Number.isFinite(numericValue)) {
        return null
    }

    if (numericValue > 0 && numericValue < 1) {
        return clamp(Math.round(numericValue * 100), 1, 99)
    }

    if (numericValue >= 1 && numericValue <= 99) {
        return clamp(Math.round(numericValue), 1, 99)
    }

    return null
}

function readKalshiMarketPriceCents(marketDetail, centsField, dollarsField) {
    const candidates = [
        marketDetail?.[centsField],
        marketDetail?.[dollarsField],
    ]

    for (const candidate of candidates) {
        const parsed = parseKalshiPriceToCents(candidate)

        if (Number.isFinite(parsed)) {
            return parsed
        }
    }

    return null
}

function formatKalshiPriceDollars(priceCents) {
    if (!Number.isFinite(Number(priceCents))) {
        return null
    }

    return (Number(priceCents) / 100).toFixed(4)
}

function extractKalshiMarket(payload) {
    if (!payload || typeof payload !== "object") {
        return null
    }

    return payload.market || payload
}

function extractKalshiOrderbook(payload) {
    const book = payload?.orderbook_fp || payload?.orderbook || payload || {}

    return {
        yes: Array.isArray(book.yes_dollars)
            ? book.yes_dollars
            : Array.isArray(book.yes)
                ? book.yes
                : [],
        no: Array.isArray(book.no_dollars)
            ? book.no_dollars
            : Array.isArray(book.no)
                ? book.no
                : [],
    }
}

function getWeakestMetric(metricScores = {}) {
    return Object.entries(metricScores).reduce((lowest, [metricType, score]) => {
        const numericScore = Number(score)

        if (!Number.isFinite(numericScore)) {
            return lowest
        }

        if (!lowest || numericScore < lowest.score) {
            return { metricType, score: numericScore }
        }

        return lowest
    }, null)
}

function buildEsgTradeSignal(esgScore) {
    const overall = Number(esgScore?.overall)

    if (!Number.isFinite(overall)) {
        throw new Error("No ESG score is available yet. Ingest ESG samples before requesting a trade plan.")
    }

    const weakestMetric = getWeakestMetric(esgScore?.metricScores || {})
    let side = "yes"
    let count = 1
    let confidence = "watch"
    let outlook = "balanced"

    if (overall >= 85) {
        side = "yes"
        count = 3
        confidence = "high"
        outlook = "positive"
    } else if (overall >= 70) {
        side = "yes"
        count = 2
        confidence = "moderate"
        outlook = "positive"
    } else if (overall >= 55) {
        side = "no"
        count = 1
        confidence = "moderate"
        outlook = "defensive"
    } else {
        side = "no"
        count = 3
        confidence = "high"
        outlook = "defensive"
    }

    const weakestMetricText = weakestMetric
        ? `${weakestMetric.metricType} (${weakestMetric.score.toFixed(2)})`
        : "no metric breakdown"
    const rationale = side === "yes"
        ? `Overall ESG score ${overall.toFixed(2)} supports a YES bias. Weakest metric: ${weakestMetricText}.`
        : `Overall ESG score ${overall.toFixed(2)} is weak enough to hedge with NO. Weakest metric: ${weakestMetricText}.`

    return {
        overall: Number(overall.toFixed(2)),
        side,
        action: "buy",
        count,
        confidence,
        outlook,
        weakestMetric: weakestMetric?.metricType || null,
        weakestMetricScore: weakestMetric ? Number(weakestMetric.score.toFixed(2)) : null,
        rationale,
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
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

function createRandomValueWithGenerator(min, max, randomFn) {
    return Number((randomFn() * (max - min) + min).toFixed(2))
}

function getExportWindow(range) {
    const selectedWindow = EXPORT_WINDOWS[String(range || "").toLowerCase()]

    if (!selectedWindow) {
        return null
    }

    return {
        ...selectedWindow,
        sinceMs: Date.now() - selectedWindow.days * 24 * 60 * 60 * 1000,
    }
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) {
        return ""
    }

    const stringValue =
        typeof value === "string" ? value : JSON.stringify(value) ?? String(value)

    if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`
    }

    return stringValue
}

function buildSensorReadingsCsv(rows) {
    const headers = [
        "id",
        "sensor_id",
        "metric_type",
        "value",
        "recorded_at",
        "created_at",
        "source",
        "owner_uid",
        "owner_email",
        "device_name",
    ]
    const lines = rows.map((row) =>
        headers.map((header) => escapeCsvValue(row?.[header])).join(",")
    )

    return [headers.join(","), ...lines].join("\n")
}

function generateFallbackSensorReadings(range) {
    const selectedWindow = getExportWindow(range) || EXPORT_WINDOWS.day
    const sensorIds = ["sensor1", "sensor2", "sensor3"]
    const baseIntervalsPerDay = 12 * 60 * 12
    const intervalCount = baseIntervalsPerDay * selectedWindow.days
    const intervalMs = 5 * 1000
    const baseTime = Date.now()
    const rows = []

    for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
        const recordedAt = new Date(baseTime - intervalIndex * intervalMs).toISOString()

        sensorIds.forEach((sensorId, sensorIndex) => {
            METRIC_TYPES.forEach((metricType, metricIndex) => {
                const baseValueByMetric = {
                    air_quality: 37,
                    no2: 14,
                    temperature: 22.4,
                    humidity: 51.4,
                    noise_levels: 43,
                }
                const metricTrend = {
                    air_quality: 0.018,
                    no2: 0.011,
                    temperature: 0.009,
                    humidity: 0.014,
                    noise_levels: 0.016,
                }
                const oscillation = Math.sin((intervalIndex + 1 + sensorIndex) / (6 + metricIndex)) * 1.7
                const value = Number(
                    (
                        baseValueByMetric[metricType]
                        + intervalIndex * metricTrend[metricType]
                        + metricIndex * 0.75
                        + sensorIndex * 1.35
                        + oscillation
                    ).toFixed(2)
                )

                rows.push({
                    id: `fallback-${selectedWindow.label}-${sensorId}-${metricType}-${intervalIndex + 1}`,
                    sensor_id: sensorId,
                    metric_type: metricType,
                    value,
                    recorded_at: recordedAt,
                    created_at: recordedAt,
                    source: "fallback",
                })
            })
        })
    }

    return rows.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
}

function hashSeed(input) {
    const text = String(input)
    let hash = 2166136261

    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
}

function createSeededRandom(seedValue) {
    let state = seedValue >>> 0

    return () => {
        state += 0x6D2B79F5
        let temp = state
        temp = Math.imul(temp ^ (temp >>> 15), temp | 1)
        temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61)
        return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296
    }
}

function normalizeSamples(metricsJson) {
    const now = Date.now()
    const timeSeries = []

    metricsJson.forEach((metric) => {
        ;(metric.values || []).forEach((sample) => {
            const numericValue = Number(sample.value)

            if (!Number.isFinite(numericValue)) {
                return
            }

            const labels = [{ name: "__name__", value: metric.name }]
            const sampleLabels = sample.labels || {}

            Object.keys(sampleLabels).forEach((key) => {
                labels.push({ name: key, value: String(sampleLabels[key]) })
            })

            const timestamp = Number.isFinite(Number(sample.timestamp))
                ? Math.trunc(Number(sample.timestamp))
                : now

            timeSeries.push({
                labels,
                samples: [
                    {
                        value: numericValue,
                        timestamp,
                    },
                ],
            })
        })
    })

    return timeSeries
}

function createTimeSeries(metricName, labelsObject, value, timestamp) {
    const labels = [{ name: "__name__", value: metricName }]

    Object.keys(labelsObject).forEach((key) => {
        labels.push({ name: key, value: String(labelsObject[key]) })
    })

    return {
        labels,
        samples: [
            {
                value: Number(value),
                timestamp: Math.trunc(Number(timestamp)),
            },
        ],
    }
}

function joinFirebasePath(...segments) {
    return segments
        .map((segment) => String(segment || "").trim())
        .filter(Boolean)
        .join("/")
}

function buildFirebaseOwnerDevicesPath(deviceRootPath, ownerUid) {
    return joinFirebasePath(deviceRootPath, ownerUid, FIREBASE_USER_DEVICES_PATH_SEGMENT)
}

function buildFirebaseDevicePath(deviceRootPath, ownerUid, deviceId) {
    return joinFirebasePath(
        deviceRootPath,
        ownerUid,
        FIREBASE_USER_DEVICES_PATH_SEGMENT,
        deviceId
    )
}

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

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || "")
    )
}

function isFirebasePermissionError(error) {
    const status = Number(error?.response?.status)
    const message = String(error?.message || "")
    const detail = String(error?.response?.data?.error || "")

    return status === 401
        || status === 403
        || message.includes("status code 401")
        || message.includes("status code 403")
        || detail.toLowerCase().includes("permission denied")
}

function createFirebaseSeriesKey(sample, source) {
    return `${sample.sensor_id}:${sample.metric_type}:${source}`
}

function normalizeFirebaseDedupValue(metricType, numericValue) {
    if (!Number.isFinite(Number(numericValue))) {
        return "nan"
    }

    if (metricType === "temperature" || metricType === "humidity") {
        return Number(numericValue).toFixed(2)
    }

    return Number(numericValue).toFixed(0)
}

function normalizeDeviceOwnerLabels(metadata = {}) {
    return {
        owner_uid: String(metadata.owner_uid || DEFAULT_DEVICE_OWNER_LABELS.owner_uid).trim()
            || DEFAULT_DEVICE_OWNER_LABELS.owner_uid,
        owner_email: String(metadata.owner_email || DEFAULT_DEVICE_OWNER_LABELS.owner_email).trim()
            || DEFAULT_DEVICE_OWNER_LABELS.owner_email,
        device_name: String(metadata.device_name || DEFAULT_DEVICE_OWNER_LABELS.device_name).trim()
            || DEFAULT_DEVICE_OWNER_LABELS.device_name,
    }
}

function normalizeMwbeUserRecord(userRecord = {}) {
    return {
        id: String(userRecord.id || "").trim(),
        email: String(userRecord.email || "").trim(),
        name: String(userRecord.name || "").trim(),
        firebase_uid: String(
            userRecord.firebase_uid
            || userRecord.firebaseUid
            || ""
        ).trim(),
    }
}

function extractFirebaseAuthToken(request = {}) {
    const authorizationHeader = String(
        request.headers?.authorization
        || request.get?.("Authorization")
        || ""
    ).trim()
    const bearerMatch = authorizationHeader.match(/^Bearer\s+(.+)$/i)

    if (bearerMatch?.[1]) {
        return String(bearerMatch[1]).trim()
    }

    return String(
        request.body?.firebaseIdToken
        || request.query?.firebaseIdToken
        || ""
    ).trim()
}

function createApp(options = {}) {
    const firebaseDb = options.firebaseDb === undefined ? db : options.firebaseDb
    const supabase = options.supabase === undefined ? createSupabaseFromEnv() : options.supabase
    const kalshiHttpClient = options.kalshiHttpClient || axios
    const mwbeHttpClient = options.mwbeHttpClient || axios
    const firebaseHttpClient = options.firebaseHttpClient || axios
    const app = express()
    const registry = new promClient.Registry()
    const state = {
        lastFirebaseSync: null,
        lastFirebaseError: null,
        lastFirebaseSamples: [],
        firebaseOwnerSyncStatus: {},
        firebaseSeriesCache: {},
        lastMwbeSync: null,
        lastMwbeError: null,
        lastMwbeSamples: [],
        sampleBuffer: [],
        latestSeries: {},
        lastEsgScore: null,
    }
    const runtimeOverrides = {
        mwbeConfig: {},
        thresholds: {},
    }

    let mwbePollTimer = null
    let firebasePollTimer = null

    const sensorDataMetric = new promClient.Gauge({
        name: "sensor_data_metric",
        help: "IoT sensor data by metric type",
        labelNames: ["sensor_id", "metric_type", "source", "owner_uid", "owner_email", "device_name"],
        registers: [registry],
    })

    const sensorDataThresholdMinMetric = new promClient.Gauge({
        name: "sensor_data_threshold_min",
        help: "Configured minimum threshold by metric type",
        labelNames: ["metric_type", "unit"],
        registers: [registry],
    })

    const sensorDataThresholdMaxMetric = new promClient.Gauge({
        name: "sensor_data_threshold_max",
        help: "Configured maximum threshold by metric type",
        labelNames: ["metric_type", "unit"],
        registers: [registry],
    })

    const sensorDataAnomalyFlagMetric = new promClient.Gauge({
        name: "sensor_data_anomaly_flag",
        help: "Whether the latest sample is outside its normal range",
        labelNames: ["sensor_id", "metric_type", "source", "owner_uid", "owner_email", "device_name", "severity"],
        registers: [registry],
    })

    const sensorDataAnomalyScoreMetric = new promClient.Gauge({
        name: "sensor_data_anomaly_score",
        help: "Relative anomaly score based on deviation from threshold",
        labelNames: ["sensor_id", "metric_type", "source", "owner_uid", "owner_email", "device_name"],
        registers: [registry],
    })

    const sensorDataLastTimestampMetric = new promClient.Gauge({
        name: "sensor_data_last_timestamp_ms",
        help: "Timestamp in milliseconds of the latest ingested sample",
        labelNames: ["sensor_id", "metric_type", "source", "owner_uid", "owner_email", "device_name"],
        registers: [registry],
    })

    const sensorDataAnomalyTotalMetric = new promClient.Counter({
        name: "sensor_data_anomaly_total",
        help: "Total anomaly count by sensor and severity",
        labelNames: ["sensor_id", "metric_type", "source", "owner_uid", "owner_email", "device_name", "severity"],
        registers: [registry],
    })

    const esgEnvironmentScoreMetric = new promClient.Gauge({
        name: "esg_environment_score",
        help: "Calculated ESG environmental score from sensor data",
        labelNames: ["scope"],
        registers: [registry],
    })

    const esgMetricScoreMetric = new promClient.Gauge({
        name: "esg_environment_metric_score",
        help: "Calculated ESG environmental score by metric type",
        labelNames: ["metric_type"],
        registers: [registry],
    })

    const esgSensorScoreMetric = new promClient.Gauge({
        name: "esg_sensor_score",
        help: "Calculated ESG score by sensor",
        labelNames: ["sensor_id", "owner_uid", "owner_email", "device_name"],
        registers: [registry],
    })

    const esgBufferSizeMetric = new promClient.Gauge({
        name: "esg_buffer_size",
        help: "Current number of buffered samples used for ESG scoring",
        registers: [registry],
    })

    const mwbeSyncRunsMetric = new promClient.Counter({
        name: "mwbe_sync_runs_total",
        help: "Total MWBE sync attempts",
        labelNames: ["status"],
        registers: [registry],
    })

    const mwbeSyncDurationMetric = new promClient.Histogram({
        name: "mwbe_sync_duration_seconds",
        help: "MWBE sync duration in seconds",
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
        registers: [registry],
    })

    const mwbeLastSyncTimestampMetric = new promClient.Gauge({
        name: "mwbe_last_sync_timestamp_ms",
        help: "Timestamp in milliseconds of the last completed MWBE sync",
        registers: [registry],
    })

    const mwbeLastSyncSampleCountMetric = new promClient.Gauge({
        name: "mwbe_last_sync_sample_count",
        help: "Number of samples processed during the last MWBE sync",
        registers: [registry],
    })

    function getEsgConfig() {
        return {
            mode: ["buffered", "streaming"].includes(String(process.env.ESG_SCORE_MODE || "").toLowerCase())
                ? String(process.env.ESG_SCORE_MODE).toLowerCase()
                : "buffered",
            bufferSize: Number(process.env.ESG_BUFFER_SIZE || 5000),
            windowMs: Number(process.env.ESG_WINDOW_MS || 60 * 60 * 1000),
            weights: {
                air_quality: 1,
                no2: 1,
                temperature: 1,
                humidity: 1,
                noise_levels: 1,
                ...parseJsonEnv(process.env.ESG_METRIC_WEIGHTS_JSON, {}),
            },
        }
    }

    function getFirebaseConfig() {
        const projectId = String(
            process.env.FIREBASE_PROJECT_ID
            || process.env.VITE_FIREBASE_PROJECT_ID
            || DEFAULT_FIREBASE_PROJECT_ID
        ).trim()
        const databaseUrl = String(
            process.env.FIREBASE_DATABASE_URL
            || process.env.VITE_FIREBASE_DATABASE_URL
            || (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : DEFAULT_FIREBASE_DATABASE_URL)
        ).replace(/\/$/, "")

        return {
            projectId,
            databaseUrl,
            deviceRootPath: String(
                process.env.FIREBASE_DEVICE_ROOT_PATH || DEFAULT_FIREBASE_DEVICE_ROOT_PATH
            ).replace(/^\/+|\/+$/g, ""),
            source: String(process.env.FIREBASE_SOURCE_NAME || "firebase-rtdb"),
            backgroundPollingEnabled: parseBoolean(
                process.env.FIREBASE_BACKGROUND_POLLING_ENABLED,
                false
            ),
            syncIntervalMs: Number(
                process.env.FIREBASE_SYNC_INTERVAL_MS || DEFAULT_FIREBASE_SYNC_INTERVAL_MS
            ),
            syncOnStart: parseBoolean(process.env.FIREBASE_SYNC_ON_START, true),
            ownerSyncIntervalMs: Number(
                process.env.FIREBASE_OWNER_SYNC_INTERVAL_MS || DEFAULT_FIREBASE_OWNER_SYNC_INTERVAL_MS
            ),
        }
    }

    function getMcpAssistantConfig() {
        return {
            apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
            apiUrl: String(process.env.OPENAI_API_URL || DEFAULT_OPENAI_RESPONSES_API_URL).trim(),
            model: String(process.env.OPENAI_MODEL || "gpt-5").trim(),
            serverUrl: String(process.env.OPENAI_MCP_SERVER_URL || "").trim(),
            serverLabel: String(process.env.OPENAI_MCP_SERVER_LABEL || "esgators").trim(),
        }
    }

    function isMcpAssistantConfigured(config = getMcpAssistantConfig()) {
        return Boolean(config.apiKey && config.serverUrl)
    }

    function extractOpenAiText(value) {
        if (!value) {
            return ""
        }

        if (typeof value === "string") {
            return value.trim()
        }

        if (Array.isArray(value)) {
            const combined = value
                .map((entry) => extractOpenAiText(entry))
                .filter(Boolean)
                .join("\n\n")

            return combined.trim()
        }

        if (typeof value !== "object") {
            return ""
        }

        if (typeof value.output_text === "string" && value.output_text.trim()) {
            return value.output_text.trim()
        }

        if (typeof value.text === "string" && value.text.trim()) {
            return value.text.trim()
        }

        if (typeof value.content === "string" && value.content.trim()) {
            return value.content.trim()
        }

        const candidateKeys = ["output", "content", "summary", "message"]
        for (const key of candidateKeys) {
            if (value[key]) {
                const extracted = extractOpenAiText(value[key])
                if (extracted) {
                    return extracted
                }
            }
        }

        return ""
    }

    function buildMcpAssistantPrompt({ question, deviceIds = [], selectedDeviceId = "" }) {
        const uniqueDeviceIds = [...new Set(
            (deviceIds || [])
                .map((deviceId) => String(deviceId || "").trim())
                .filter(Boolean)
        )]
        const selectedLine = selectedDeviceId
            ? `The user selected device ${selectedDeviceId} as their primary context.`
            : "The user did not select a single device, so consider all available owned devices."
        const deviceSummary = uniqueDeviceIds.length > 0
            ? `The signed-in user currently owns these device IDs: ${uniqueDeviceIds.join(", ")}.`
            : "No owned device IDs were provided by the frontend, so discover devices through MCP tools if needed."

        return [
            "You are the ESGators device assistant inside the user's devices page.",
            "Use the connected ESGators MCP tools to inspect live Firebase data, historical trends, backend status, and anomaly context before answering.",
            "Return only the final user-facing answer. Do not paste raw JSON, full MCP payloads, tool traces, schema blocks, or internal IDs unless the user explicitly asks for them.",
            "Summarize readings and anomalies in plain language with short bullets or short paragraphs when helpful.",
            selectedLine,
            deviceSummary,
            "Keep the answer concise, practical, and grounded in the available telemetry. If the data is missing or insufficient, say that clearly.",
            `User question: ${question}`,
        ].join("\n\n")
    }

    async function askMcpAssistant({ question, deviceIds = [], selectedDeviceId = "" }) {
        const config = getMcpAssistantConfig()

        if (!isMcpAssistantConfigured(config)) {
            const error = new Error(
                "MCP assistant is not configured. Set OPENAI_API_KEY and OPENAI_MCP_SERVER_URL in backend/.env."
            )
            error.statusCode = 503
            throw error
        }

        const response = await axios.post(
            config.apiUrl,
            {
                model: config.model,
                tools: [
                    {
                        type: "mcp",
                        server_label: config.serverLabel,
                        server_description: "Firebase and Supabase backed IoT sensor context for ESGators.",
                        server_url: config.serverUrl,
                        require_approval: "never",
                    },
                ],
                input: buildMcpAssistantPrompt({ question, deviceIds, selectedDeviceId }),
            },
            {
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 90000,
                validateStatus: (status) => status >= 200 && status < 300,
            }
        )

        const answer = extractOpenAiText(response.data)

        if (!answer) {
            throw new Error("OpenAI returned a response, but no answer text was found.")
        }

        return {
            answer,
            model: config.model,
            serverUrl: config.serverUrl,
            responseId: response.data?.id || null,
        }
    }

    function resolveThresholds() {
        const envOverrides = parseJsonEnv(process.env.SENSOR_THRESHOLDS_JSON, {})
        const thresholds = {}

        METRIC_TYPES.forEach((metricType) => {
            const defaults = DEFAULT_THRESHOLDS[metricType]
            const override = {
                ...(envOverrides?.[metricType] || {}),
                ...(runtimeOverrides.thresholds?.[metricType] || {}),
            }
            thresholds[metricType] = {
                min: Number.isFinite(Number(override.min)) ? Number(override.min) : defaults.min,
                max: Number.isFinite(Number(override.max)) ? Number(override.max) : defaults.max,
                warningMin: Number.isFinite(Number(override.warningMin)) ? Number(override.warningMin) : defaults.warningMin,
                warningMax: Number.isFinite(Number(override.warningMax)) ? Number(override.warningMax) : defaults.warningMax,
                criticalMin: Number.isFinite(Number(override.criticalMin)) ? Number(override.criticalMin) : defaults.criticalMin,
                criticalMax: Number.isFinite(Number(override.criticalMax)) ? Number(override.criticalMax) : defaults.criticalMax,
                unit: override.unit || defaults.unit,
            }
        })

        return thresholds
    }

    function publishThresholdMetrics() {
        const thresholds = resolveThresholds()

        METRIC_TYPES.forEach((metricType) => {
            const threshold = thresholds[metricType]
            sensorDataThresholdMinMetric.set(
                { metric_type: metricType, unit: threshold.unit },
                threshold.min
            )
            sensorDataThresholdMaxMetric.set(
                { metric_type: metricType, unit: threshold.unit },
                threshold.max
            )
        })
    }

    function evaluateAnomaly(metricType, numericValue) {
        const threshold = resolveThresholds()[metricType]

        if (!threshold) {
            return { isAnomaly: false, severity: "normal", score: 0, threshold: null }
        }

        if (numericValue >= threshold.min && numericValue <= threshold.max) {
            return { isAnomaly: false, severity: "normal", score: 0, threshold }
        }

        if (Number.isFinite(threshold.criticalMin) && numericValue < threshold.criticalMin) {
            const distance = threshold.criticalMin - numericValue
            const denominator = Math.max(Math.abs(threshold.criticalMin), 1)
            return {
                isAnomaly: true,
                severity: "critical",
                score: Number((distance / denominator).toFixed(4)),
                threshold,
            }
        }

        if (Number.isFinite(threshold.criticalMax) && numericValue >= threshold.criticalMax) {
            const distance = numericValue - threshold.criticalMax
            const denominator = Math.max(Math.abs(threshold.criticalMax), 1)
            return {
                isAnomaly: true,
                severity: "critical",
                score: Number((distance / denominator).toFixed(4)),
                threshold,
            }
        }

        if (Number.isFinite(threshold.warningMin) && numericValue < threshold.min) {
            const distance = threshold.min - numericValue
            const denominator = Math.max(Math.abs(threshold.min - threshold.warningMin), 1)
            return {
                isAnomaly: true,
                severity: "warning",
                score: Number((distance / denominator).toFixed(4)),
                threshold,
            }
        }

        if (Number.isFinite(threshold.warningMax) && numericValue > threshold.max) {
            const distance = numericValue - threshold.max
            const denominator = Math.max(Math.abs(threshold.warningMax - threshold.max), 1)
            return {
                isAnomaly: true,
                severity: "warning",
                score: Number((distance / denominator).toFixed(4)),
                threshold,
            }
        }

        const boundary = numericValue < threshold.min ? threshold.min : threshold.max
        const distance = Math.abs(numericValue - boundary)
        const denominator = Math.max(Math.abs(boundary), 1)
        return {
            isAnomaly: true,
            severity: "warning",
            score: Number((distance / denominator).toFixed(4)),
            threshold,
        }
    }

    function normalizeSampleTimestamp(value) {
        return Number.isFinite(Number(value))
            ? Math.trunc(Number(value))
            : Date.now()
    }

    function buildAcceptedSample(source, sample) {
        const sensorId = String(sample.sensor_id)
        const metricType = String(sample.metric_type).toLowerCase()
        const numericValue = Number(sample.value)
        const timestamp = normalizeSampleTimestamp(sample.timestamp)
        const ownerLabels = normalizeDeviceOwnerLabels(sample)
        const anomaly = evaluateAnomaly(metricType, numericValue)

        return {
            sensor_id: sensorId,
            metric_type: metricType,
            value: numericValue,
            source,
            timestamp,
            ...ownerLabels,
            esg_score: computeSampleEsgScore({
                detected: anomaly.isAnomaly,
                severity: anomaly.severity,
                score: anomaly.score,
            }),
            anomaly: {
                detected: anomaly.isAnomaly,
                severity: anomaly.severity,
                score: anomaly.score,
                threshold: anomaly.threshold,
            },
        }
    }

    function publishAcceptedSampleMetrics(sample) {
        const sensorId = String(sample.sensor_id)
        const metricType = String(sample.metric_type).toLowerCase()
        const numericValue = Number(sample.value)
        const timestamp = normalizeSampleTimestamp(sample.timestamp)
        const ownerLabels = normalizeDeviceOwnerLabels(sample)
        const anomaly = sample.anomaly || { detected: false, severity: "normal", score: 0 }

        sensorDataMetric.set(
            {
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
            },
            numericValue
        )
        sensorDataAnomalyScoreMetric.set(
            {
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
            },
            anomaly.score
        )
        sensorDataLastTimestampMetric.set(
            {
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
            },
            timestamp
        )

        sensorDataAnomalyFlagMetric.set(
            {
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
                severity: "warning",
            },
            anomaly.detected && anomaly.severity === "warning" ? 1 : 0
        )
        sensorDataAnomalyFlagMetric.set(
            {
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
                severity: "critical",
            },
            anomaly.detected && anomaly.severity === "critical" ? 1 : 0
        )

        if (anomaly.detected) {
            sensorDataAnomalyTotalMetric.inc({
                sensor_id: sensorId,
                metric_type: metricType,
                source: sample.source,
                ...ownerLabels,
                severity: anomaly.severity,
            })
        }
    }

    function computeSampleEsgScore(anomaly) {
        if (!anomaly?.detected) {
            return 100
        }

        if (anomaly.severity === "warning") {
            return Number(clamp(80 - anomaly.score * 20, 60, 80).toFixed(2))
        }

        return Number(clamp(45 - anomaly.score * 45, 0, 45).toFixed(2))
    }

    function updateEsgState(samples) {
        const config = getEsgConfig()

        samples.forEach((sample) => {
            state.sampleBuffer.push(sample)
            state.latestSeries[`${sample.sensor_id}:${sample.metric_type}:${sample.source}`] = sample
        })

        if (state.sampleBuffer.length > config.bufferSize) {
            state.sampleBuffer = state.sampleBuffer.slice(-config.bufferSize)
        }

        const bufferedSamples = config.mode === "streaming"
            ? Object.values(state.latestSeries)
            : state.sampleBuffer.filter((sample) => sample.timestamp >= Date.now() - config.windowMs)

        esgBufferSizeMetric.set(bufferedSamples.length)

        if (bufferedSamples.length === 0) {
            state.lastEsgScore = {
                mode: config.mode,
                computedAt: Date.now(),
                overall: null,
                sampleCount: 0,
                metricScores: {},
                sensorScores: {},
            }
            return
        }

        const metricBuckets = {}
        const sensorBuckets = {}
        const sensorLabels = {}

        bufferedSamples.forEach((sample) => {
            metricBuckets[sample.metric_type] = metricBuckets[sample.metric_type] || []
            metricBuckets[sample.metric_type].push(sample.esg_score)

            sensorBuckets[sample.sensor_id] = sensorBuckets[sample.sensor_id] || []
            sensorBuckets[sample.sensor_id].push(sample.esg_score)

            sensorLabels[sample.sensor_id] = normalizeDeviceOwnerLabels(sample)
        })

        const metricScores = {}
        let weightedTotal = 0
        let totalWeight = 0

        Object.keys(metricBuckets).forEach((metricType) => {
            const scores = metricBuckets[metricType]
            const average = scores.reduce((sum, value) => sum + value, 0) / scores.length
            const rounded = Number(average.toFixed(2))
            const weight = Number(config.weights?.[metricType] ?? 1)

            metricScores[metricType] = rounded
            weightedTotal += rounded * weight
            totalWeight += weight
            esgMetricScoreMetric.set({ metric_type: metricType }, rounded)
        })

        const sensorScores = {}
        Object.keys(sensorBuckets).forEach((sensorId) => {
            const scores = sensorBuckets[sensorId]
            const average = scores.reduce((sum, value) => sum + value, 0) / scores.length
            const rounded = Number(average.toFixed(2))
            sensorScores[sensorId] = rounded
            esgSensorScoreMetric.set(
                {
                    sensor_id: sensorId,
                    ...normalizeDeviceOwnerLabels(sensorLabels[sensorId]),
                },
                rounded
            )
        })

        const overall = totalWeight > 0
            ? Number((weightedTotal / totalWeight).toFixed(2))
            : null

        if (overall !== null) {
            esgEnvironmentScoreMetric.set({ scope: "overall" }, overall)
        }

        state.lastEsgScore = {
            mode: config.mode,
            computedAt: Date.now(),
            overall,
            sampleCount: bufferedSamples.length,
            metricScores,
            sensorScores,
        }
    }

    function buildDynamicTimeSeries(samples) {
        const timeseries = []

        samples.forEach((sample) => {
            const ownerLabels = normalizeDeviceOwnerLabels(sample)

            timeseries.push(createTimeSeries(
                "sensor_data_metric",
                {
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    source: sample.source,
                    ...ownerLabels,
                },
                sample.value,
                sample.timestamp
            ))

            timeseries.push(createTimeSeries(
                "sensor_data_anomaly_score",
                {
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    source: sample.source,
                    ...ownerLabels,
                },
                sample.anomaly.score,
                sample.timestamp
            ))

            timeseries.push(createTimeSeries(
                "sensor_data_anomaly_flag",
                {
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    source: sample.source,
                    ...ownerLabels,
                    severity: "warning",
                },
                sample.anomaly.detected && sample.anomaly.severity === "warning" ? 1 : 0,
                sample.timestamp
            ))

            timeseries.push(createTimeSeries(
                "sensor_data_anomaly_flag",
                {
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    source: sample.source,
                    ...ownerLabels,
                    severity: "critical",
                },
                sample.anomaly.detected && sample.anomaly.severity === "critical" ? 1 : 0,
                sample.timestamp
            ))
        })

        if (state.lastEsgScore?.overall !== null && Number.isFinite(Number(state.lastEsgScore?.computedAt))) {
            timeseries.push(createTimeSeries(
                "esg_environment_score",
                { scope: "overall" },
                state.lastEsgScore.overall,
                state.lastEsgScore.computedAt
            ))
        }

        return timeseries
    }

    async function pushMetricsToGrafana(extraTimeSeries = []) {
        const username = process.env.GRAFANA_USERNAME
        const apiKey = process.env.GRAFANA_API_KEY
        const pushUrl = process.env.GRAFANA_PUSH_URL

        if (!username || !apiKey || !pushUrl) {
            return { pushed: 0, skipped: true, reason: "missing_remote_write_config" }
        }

        const timeseries = extraTimeSeries.length > 0
            ? extraTimeSeries
            : normalizeSamples(await registry.getMetricsAsJSON())

        if (timeseries.length === 0) {
            return { pushed: 0, skipped: true, reason: "empty_timeseries" }
        }

        const WriteRequest = await loadWriteRequestType()
        const payload = WriteRequest.encode({ timeseries }).finish()
        const compressedPayload = await snappy.compress(payload)
        const auth = Buffer.from(`${username}:${apiKey}`).toString("base64")

        await axios.post(pushUrl, compressedPayload, {
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-protobuf",
                "Content-Encoding": "snappy",
                "X-Prometheus-Remote-Write-Version": "0.1.0",
            },
            maxBodyLength: Infinity,
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 300,
        }).catch((error) => {
            const status = error?.response?.status
            const responseBody = error?.response?.data
            const detail = responseBody
                ? (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody))
                : error.message

            throw new Error(
                `Grafana push failed${status ? ` (HTTP ${status})` : ""}: ${detail}`
            )
        })

        console.log(`Pushed metrics to Grafana Cloud: ${timeseries.length} samples`)
        return { pushed: timeseries.length, skipped: false }
    }

    async function loadDeviceOwnerMetadataMap(sensorIds) {
        const uniqueSensorIds = [...new Set(
            (sensorIds || [])
                .map((sensorId) => String(sensorId || "").trim())
                .filter(Boolean)
        )]

        if (!supabase || uniqueSensorIds.length === 0) {
            return new Map()
        }

        const metadataBySensorId = new Map()

        const { data: devices, error: devicesError } = await supabase
            .from("devices")
            .select("device_id, owner_uid, name")
            .in("device_id", uniqueSensorIds)

        if (devicesError) {
            console.warn(`Failed to load device owner metadata: ${devicesError.message}`)
            return metadataBySensorId
        }

        const ownerKeys = [...new Set((devices || []).map((device) => device.owner_uid).filter(Boolean))]
        const ownersByKey = new Map()

        const ownerUuidKeys = ownerKeys.filter(isUuid)
        if (ownerUuidKeys.length > 0) {
            const { data: ownersById, error: ownersByIdError } = await supabase
                .from("users")
                .select("id, email, firebase_uid")
                .in("id", ownerUuidKeys)

            if (ownersByIdError) {
                console.warn(`Failed to load owner metadata by user id: ${ownersByIdError.message}`)
            } else {
                ;(ownersById || []).forEach((owner) => {
                    ownersByKey.set(owner.id, owner)
                    if (owner.firebase_uid) {
                        ownersByKey.set(owner.firebase_uid, owner)
                    }
                })
            }
        }

        const ownerFirebaseUidKeys = ownerKeys.filter((ownerKey) => !isUuid(ownerKey))
        if (ownerFirebaseUidKeys.length > 0) {
            const { data: ownersByFirebaseUid, error: ownersByFirebaseUidError } = await supabase
                .from("users")
                .select("id, email, firebase_uid")
                .in("firebase_uid", ownerFirebaseUidKeys)

            if (ownersByFirebaseUidError) {
                console.warn(`Failed to load owner metadata by firebase uid: ${ownersByFirebaseUidError.message}`)
            } else {
                ;(ownersByFirebaseUid || []).forEach((owner) => {
                    ownersByKey.set(owner.id, owner)
                    if (owner.firebase_uid) {
                        ownersByKey.set(owner.firebase_uid, owner)
                    }
                })
            }
        }

        ;(devices || []).forEach((device) => {
            const owner = ownersByKey.get(device.owner_uid)
            metadataBySensorId.set(device.device_id, normalizeDeviceOwnerLabels({
                owner_uid: owner?.firebase_uid || device.owner_uid || DEFAULT_DEVICE_OWNER_LABELS.owner_uid,
                owner_email: owner?.email || DEFAULT_DEVICE_OWNER_LABELS.owner_email,
                device_name: device.name || device.device_id || DEFAULT_DEVICE_OWNER_LABELS.device_name,
            }))
        })

        return metadataBySensorId
    }

    async function persistAcceptedSamples(samples) {
        if (!supabase || samples.length === 0) {
            return { stored: 0, skipped: true, reason: "missing_supabase" }
        }

        const rows = samples.map((sample) => ({
            sensor_id: sample.sensor_id,
            metric_type: sample.metric_type,
            value: sample.value,
            recorded_at: new Date(normalizeSampleTimestamp(sample.timestamp)).toISOString(),
        }))

        const { error } = await supabase
            .from("sensor_readings")
            .insert(rows)

        if (error) {
            throw new Error(error.message)
        }

        return { stored: rows.length, skipped: false }
    }

    async function hydrateEsgStateFromStoredReadings() {
        const config = getEsgConfig()

        if (state.sampleBuffer.length > 0 && Number.isFinite(Number(state.lastEsgScore?.overall))) {
            return state.lastEsgScore
        }

        if (!supabase) {
            return state.lastEsgScore
        }

        const { data, error } = await supabase
            .from("sensor_readings")
            .select("sensor_id, metric_type, value, recorded_at")
            .gte("recorded_at", new Date(Date.now() - config.windowMs).toISOString())
            .order("recorded_at", { ascending: false })

        if (error) {
            throw new Error(error.message)
        }

        const recoveredSamples = (data || [])
            .map((row) => buildAcceptedSample("supabase-recovery", {
                sensor_id: row.sensor_id,
                metric_type: row.metric_type,
                value: row.value,
                timestamp: Date.parse(row.recorded_at),
            }))
            .filter((sample) => Number.isFinite(Number(sample.timestamp)))
            .sort((left, right) => Number(left.timestamp) - Number(right.timestamp))

        if (recoveredSamples.length === 0) {
            return state.lastEsgScore
        }

        state.sampleBuffer = []
        state.latestSeries = {}
        updateEsgState(recoveredSamples.slice(-config.bufferSize))

        return state.lastEsgScore
    }

    async function resolveCurrentEsgScore() {
        if (Number.isFinite(Number(state.lastEsgScore?.overall))) {
            return state.lastEsgScore
        }

        return hydrateEsgStateFromStoredReadings()
    }

    async function ingestSamples(samples, source) {
        const accepted = []
        const rejected = []
        const ownerMetadataBySensorId = await loadDeviceOwnerMetadataMap(
            samples.map((sample) => sample?.sensor_id)
        )

        samples.forEach((sample, index) => {
            const metricType = String(sample.metric_type ?? "").toLowerCase()
            const numericValue = Number(sample.value)
            const sensorId = String(sample.sensor_id || "")
            const ownerMetadata = normalizeDeviceOwnerLabels({
                ...ownerMetadataBySensorId.get(sensorId),
                owner_uid: sample.owner_uid || ownerMetadataBySensorId.get(sensorId)?.owner_uid,
                owner_email: sample.owner_email || ownerMetadataBySensorId.get(sensorId)?.owner_email,
                device_name: sample.device_name || ownerMetadataBySensorId.get(sensorId)?.device_name || sensorId,
            })

            if (!sample.sensor_id || !METRIC_TYPES.includes(metricType) || !Number.isFinite(numericValue)) {
                rejected.push({
                    index,
                    sample,
                    reason: "sample must include sensor_id, numeric value, and supported metric_type",
                })
                return
            }

            accepted.push(buildAcceptedSample(source, {
                sensor_id: sample.sensor_id,
                metric_type: metricType,
                value: numericValue,
                timestamp: sample.timestamp,
                ...ownerMetadata,
            }))
        })

        let pushResult = { pushed: 0, skipped: true, reason: "no_valid_samples" }

        if (accepted.length > 0) {
            accepted.forEach((sample) => {
                publishAcceptedSampleMetrics(sample)
            })
            updateEsgState(accepted)
            try {
                await persistAcceptedSamples(accepted)
            } catch (error) {
                console.warn(`Sensor reading persistence failed: ${error.message}`)
            }
            pushResult = await pushMetricsToGrafana(buildDynamicTimeSeries(accepted))
        }

        return { accepted, rejected, pushResult }
    }

    function getBufferedSensorReadings(options) {
        const selectedWindow = getExportWindow(options.range)

        if (!selectedWindow) {
            throw new Error("range must be one of: day, week, month")
        }

        const requestedSensorId = String(options.sensor_id || "").trim()
        const requestedMetricType = String(options.metric_type || "").trim().toLowerCase()

        return state.sampleBuffer
            .filter((sample) => Number(sample.timestamp) >= selectedWindow.sinceMs)
            .filter((sample) => !requestedSensorId || sample.sensor_id === requestedSensorId)
            .filter((sample) => !requestedMetricType || sample.metric_type === requestedMetricType)
            .sort((left, right) => Number(right.timestamp) - Number(left.timestamp))
            .map((sample, index) => {
                const recordedAt = new Date(Number(sample.timestamp)).toISOString()

                return {
                    id: `memory-${sample.sensor_id}-${sample.metric_type}-${sample.timestamp}-${index + 1}`,
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    value: sample.value,
                    recorded_at: recordedAt,
                    created_at: recordedAt,
                    source: sample.source,
                    owner_uid: sample.owner_uid,
                    owner_email: sample.owner_email,
                    device_name: sample.device_name,
                }
            })
    }

    async function getStoredSensorReadings(options) {
        const selectedWindow = getExportWindow(options.range)

        if (!selectedWindow || !supabase) {
            return []
        }

        let query = supabase
            .from("sensor_readings")
            .select("id, sensor_id, metric_type, value, recorded_at, created_at")
            .gte("recorded_at", new Date(selectedWindow.sinceMs).toISOString())
            .order("recorded_at", { ascending: false })

        if (options.sensor_id) {
            query = query.eq("sensor_id", options.sensor_id)
        }

        if (options.metric_type) {
            query = query.eq("metric_type", options.metric_type)
        }

        const { data, error } = await query

        if (error) {
            throw new Error(error.message)
        }

        return (data || []).map((row) => ({
            ...row,
            source: row.source,
            owner_uid: row.owner_uid,
            owner_email: row.owner_email,
            device_name: row.device_name,
        }))
    }

    async function exportSensorReadingsCsv(options) {
        const selectedWindow = getExportWindow(options.range)

        if (!selectedWindow) {
            throw new Error("range must be one of: day, week, month")
        }

        let rows = []

        if (supabase) {
            try {
                rows = await getStoredSensorReadings(options)
            } catch (error) {
                console.warn(`Export DB lookup failed for ${options.range}: ${error.message}`)
            }
        }

        if (rows.length === 0) {
            rows = getBufferedSensorReadings(options)
        }

        if (rows.length === 0) {
            rows = generateFallbackSensorReadings(options.range)
        }

        return {
            csv: buildSensorReadingsCsv(rows),
            fileName: `sensor-readings-${selectedWindow.label}.csv`,
        }
    }

    function getMwbeConfig() {
        const configuredBaseUrl = String(
            process.env.MWBE_API_BASE_URL
            || process.env.VITE_MWBE_API_BASE_URL
            || ""
        ).trim()
        const fallbackBaseUrl = configuredBaseUrl
            || (
                String(process.env.MWBE_API_URL || "").trim()
                    ? (() => {
                        try {
                            return new URL(String(process.env.MWBE_API_URL).trim()).origin
                        } catch {
                            return ""
                        }
                    })()
                    : ""
            )

        return {
            url: process.env.MWBE_API_URL || "",
            baseUrl: normalizeBaseUrl(fallbackBaseUrl, DEFAULT_MWBE_API_BASE_URL),
            method: String(process.env.MWBE_API_METHOD || "GET").toUpperCase(),
            timeoutMs: Number(process.env.MWBE_API_TIMEOUT_MS || 10000),
            headers: parseJsonEnv(process.env.MWBE_API_HEADERS_JSON, {}),
            body: parseJsonEnv(process.env.MWBE_API_BODY_JSON, null),
            responsePath: process.env.MWBE_API_RESPONSE_PATH || "",
            sensorIdField: process.env.MWBE_API_SENSOR_ID_FIELD || "sensor_id",
            metricField: process.env.MWBE_API_METRIC_FIELD || "metric_type",
            valueField: process.env.MWBE_API_VALUE_FIELD || "value",
            timestampField: process.env.MWBE_API_TIMESTAMP_FIELD || "timestamp",
            source: process.env.MWBE_SOURCE_NAME || "mwbe",
            syncIntervalMs: Number(process.env.MWBE_SYNC_INTERVAL_MS || 60000),
            syncOnStart: parseBoolean(process.env.MWBE_SYNC_ON_START, false),
            ...runtimeOverrides.mwbeConfig,
        }
    }

    async function callKalshiApi({
        endpointPath,
        method = "GET",
        params = {},
        authRequired = false,
        data = undefined,
        headers: customHeaders = {},
    }) {
        const config = getKalshiConfig()
        const normalizedEndpointPath = String(endpointPath || "").startsWith("/")
            ? String(endpointPath)
            : `/${endpointPath}`
        const url = new URL(`${config.baseUrl}${normalizedEndpointPath}`)
        const headers = { ...customHeaders }

        if (authRequired || parseBoolean(process.env.KALSHI_SIGN_PUBLIC_REQUESTS, false)) {
            Object.assign(headers, buildKalshiAuthHeaders(config, method, url.pathname))
        }

        const response = await kalshiHttpClient({
            method,
            url: url.toString(),
            params,
            data,
            headers,
            timeout: config.timeoutMs,
            validateStatus: (status) => status >= 200 && status < 300,
        })

        return response.data
    }

    async function loadCategoryFilteredKalshiMarkets(query) {
        const requestedCategory = normalizeKalshiCategory(query?.category)
        const requestedStatus = String(query?.status || "").trim()
        const requestedLimit = clamp(Number.parseInt(String(query?.limit || "100"), 10) || 100, 1, 1000)
        const requestedCursor = String(query?.cursor || "").trim()
        const maxPages = 5
        let nextCursor = requestedCursor
        let pageCount = 0
        let hasMore = false
        const collectedMarkets = []

        while (pageCount < maxPages && collectedMarkets.length < requestedLimit) {
            const params = {
                ...pickKalshiQueryParams(query, KALSHI_EVENTS_QUERY_PARAMS),
                limit: "200",
                with_nested_markets: "true",
            }

            if (requestedStatus) {
                params.status = normalizeKalshiStatus(requestedStatus)
            }

            if (nextCursor) {
                params.cursor = nextCursor
            } else {
                delete params.cursor
            }

            const data = await callKalshiApi({
                endpointPath: "/events",
                params,
            })

            const events = Array.isArray(data?.events) ? data.events : []
            const matchingEvents = events.filter((event) => (
                !requestedCategory || normalizeKalshiCategory(event?.category) === requestedCategory
            ))

            collectedMarkets.push(...extractKalshiEventMarkets(matchingEvents, requestedStatus))

            nextCursor = String(data?.cursor || "").trim()
            hasMore = Boolean(nextCursor)
            pageCount += 1

            if (!hasMore || events.length === 0) {
                break
            }
        }

        return {
            markets: collectedMarkets.slice(0, requestedLimit),
            cursor: hasMore && collectedMarkets.length >= requestedLimit ? nextCursor : "",
        }
    }

    function resolveKalshiLimitPriceCents(marketDetail, orderbook, side) {
        const lastPrice = readKalshiMarketPriceCents(marketDetail, "last_price", "last_price_dollars")
        const sideLevels = side === "yes" ? orderbook?.yes : orderbook?.no
        const topLevelPrice = Array.isArray(sideLevels?.[0])
            ? parseKalshiPriceToCents(sideLevels[0][0])
            : null
        const fallbackNoFromLast = Number.isFinite(lastPrice) ? 100 - lastPrice : null
        const candidates = side === "yes"
            ? [
                readKalshiMarketPriceCents(marketDetail, "yes_ask", "yes_ask_dollars"),
                readKalshiMarketPriceCents(marketDetail, "yes_price", "yes_price_dollars"),
                topLevelPrice,
                lastPrice,
            ]
            : [
                readKalshiMarketPriceCents(marketDetail, "no_ask", "no_ask_dollars"),
                readKalshiMarketPriceCents(marketDetail, "no_price", "no_price_dollars"),
                topLevelPrice,
                fallbackNoFromLast,
            ]

        return candidates.find((candidate) => Number.isFinite(candidate)) ?? 50
    }

    async function buildEsgTradePlan({ ticker, count, side, action, subaccount } = {}) {
        const normalizedTicker = String(ticker || "").trim()

        if (!normalizedTicker) {
            throw new Error("ticker is required to build an ESG trade plan")
        }

        const esgScore = await resolveCurrentEsgScore()
        const signal = buildEsgTradeSignal(esgScore)
        const marketPayload = await callKalshiApi({
            endpointPath: buildKalshiPath("markets", normalizedTicker),
        })
        const orderbookPayload = await callKalshiApi({
            endpointPath: buildKalshiPath("markets", normalizedTicker, "orderbook"),
            params: { depth: 10 },
        })
        const marketDetail = extractKalshiMarket(marketPayload)
        const orderbook = extractKalshiOrderbook(orderbookPayload)

        if (!marketDetail) {
            throw new Error(`Kalshi market ${normalizedTicker} was not found`)
        }

        const resolvedSide = ["yes", "no"].includes(String(side || "").trim().toLowerCase())
            ? String(side).trim().toLowerCase()
            : signal.side
        const resolvedAction = ["buy", "sell"].includes(String(action || "").trim().toLowerCase())
            ? String(action).trim().toLowerCase()
            : signal.action
        const resolvedCount = Number.isInteger(Number(count)) && Number(count) > 0
            ? Number(count)
            : signal.count
        const limitPriceCents = resolveKalshiLimitPriceCents(marketDetail, orderbook, resolvedSide)
        const orderPreview = {
            ticker: normalizedTicker,
            client_order_id: crypto.randomUUID(),
            side: resolvedSide,
            action: resolvedAction,
            count: resolvedCount,
            time_in_force: "good_till_canceled",
            cancel_order_on_pause: true,
        }

        if (resolvedSide === "yes") {
            orderPreview.yes_price = limitPriceCents
        } else {
            orderPreview.no_price = limitPriceCents
        }

        if (Number.isInteger(Number(subaccount)) && Number(subaccount) >= 0) {
            orderPreview.subaccount = Number(subaccount)
        }

        return {
            generatedAt: Date.now(),
            esg: esgScore,
            signal: {
                ...signal,
                side: resolvedSide,
                action: resolvedAction,
                count: resolvedCount,
                limitPriceCents,
                limitPriceDollars: formatKalshiPriceDollars(limitPriceCents),
            },
            market: {
                ticker: marketDetail.ticker || normalizedTicker,
                title: marketDetail.title || marketDetail.subtitle || marketDetail.question || normalizedTicker,
                status: marketDetail.status || null,
                closeTime: marketDetail.close_time || marketDetail.expiration_time || null,
                yesAsk: readKalshiMarketPriceCents(marketDetail, "yes_ask", "yes_ask_dollars"),
                noAsk: readKalshiMarketPriceCents(marketDetail, "no_ask", "no_ask_dollars"),
                lastPrice: readKalshiMarketPriceCents(marketDetail, "last_price", "last_price_dollars"),
            },
            orderbook: {
                yes: orderbook.yes.slice(0, 6),
                no: orderbook.no.slice(0, 6),
            },
            orderPreview,
        }
    }

    function normalizeMwbePayload(payload, config) {
        const rawItems = getByPath(payload, config.responsePath)
        const items = Array.isArray(rawItems)
            ? rawItems
            : rawItems && typeof rawItems === "object"
                ? [rawItems]
                : Array.isArray(payload)
                    ? payload
                    : []

        return items.map((item) => ({
            sensor_id: item?.[config.sensorIdField],
            metric_type: item?.[config.metricField],
            value: item?.[config.valueField],
            timestamp: item?.[config.timestampField],
        }))
    }

    async function syncMwbeData() {
        const config = getMwbeConfig()
        const stopTimer = mwbeSyncDurationMetric.startTimer()

        try {
            if (!config.url) {
                throw new Error("MWBE_API_URL is not configured")
            }

            const response = await axios({
                method: config.method,
                url: config.url,
                headers: config.headers,
                data: config.body,
                timeout: config.timeoutMs,
                validateStatus: (status) => status >= 200 && status < 300,
            })

            const samples = normalizeMwbePayload(response.data, config)
            const result = await ingestSamples(samples, config.source)

            const now = Date.now()
            state.lastMwbeSync = {
                syncedAt: now,
                requestedUrl: config.url,
                accepted: result.accepted.length,
                rejected: result.rejected.length,
                pushResult: result.pushResult,
            }
            state.lastMwbeError = null
            state.lastMwbeSamples = result.accepted.slice(0, 20)

            mwbeSyncRunsMetric.inc({ status: "success" })
            mwbeLastSyncTimestampMetric.set(now)
            mwbeLastSyncSampleCountMetric.set(result.accepted.length)

            stopTimer()
            return result
        } catch (error) {
            state.lastMwbeError = {
                message: error?.message || "Unknown MWBE sync error",
                failedAt: Date.now(),
            }
            mwbeSyncRunsMetric.inc({ status: "error" })
            stopTimer()
            throw error
        }
    }

    async function readFirebaseValue(pathToRead, options = {}) {
        if (firebaseDb) {
            const snapshot = await firebaseDb.ref(pathToRead).once("value")
            return snapshot.val()
        }

        const config = getFirebaseConfig()

        if (!config.databaseUrl) {
            throw new Error("Firebase database URL is not configured")
        }

        const authToken = String(options.authToken || "").trim()
        const response = await firebaseHttpClient({
            method: "GET",
            url: `${config.databaseUrl}/${pathToRead}.json`,
            params: authToken ? { auth: authToken } : {},
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 300,
        })

        return response.data
    }

    async function callMwbeApi({ endpointPath, method = "GET", params = {} }) {
        const config = getMwbeConfig()
        const baseUrl = normalizeBaseUrl(config.baseUrl, DEFAULT_MWBE_API_BASE_URL)

        if (!baseUrl) {
            throw new Error("MWBE API base URL is not configured")
        }

        const url = new URL(
            String(endpointPath || "").startsWith("/")
                ? `${baseUrl}${endpointPath}`
                : `${baseUrl}/${String(endpointPath || "").replace(/^\/+/, "")}`
        )
        const response = await mwbeHttpClient({
            method,
            url: url.toString(),
            params,
            timeout: config.timeoutMs,
            validateStatus: (status) => status >= 200 && status < 300,
        })

        return response.data
    }

    async function loadOwnerRecordFromMwbe(ownerUid) {
        const normalizedOwnerUid = String(ownerUid || "").trim()

        if (!normalizedOwnerUid) {
            return null
        }

        const payload = await callMwbeApi({
            endpointPath: "/users",
        })
        const users = Array.isArray(payload?.users) ? payload.users : []
        const matchedUser = users
            .map((user) => normalizeMwbeUserRecord(user))
            .find((user) => user.id === normalizedOwnerUid || user.firebase_uid === normalizedOwnerUid)

        return matchedUser || null
    }

    async function loadOwnedFirebaseDeviceIdsFromMwbe(ownerUid) {
        const normalizedOwnerUid = String(ownerUid || "").trim()

        if (!normalizedOwnerUid) {
            return []
        }

        const payload = await callMwbeApi({
            endpointPath: "/devices/owned",
            params: { ownerUid: normalizedOwnerUid },
        })

        return [...new Set(
            (Array.isArray(payload?.devices) ? payload.devices : [])
                .map((device) => String(device?.deviceId || "").trim())
                .filter(Boolean)
        )]
    }

    async function loadOwnerRecord(ownerUid) {
        const normalizedOwnerUid = String(ownerUid || "").trim()

        if (!normalizedOwnerUid) {
            return null
        }

        if (!supabase) {
            return loadOwnerRecordFromMwbe(normalizedOwnerUid)
        }

        const ownerQuery = supabase
            .from("users")
            .select("id, email, name, firebase_uid")

        const { data, error } = isUuid(normalizedOwnerUid)
            ? await ownerQuery.eq("id", normalizedOwnerUid).maybeSingle()
            : await ownerQuery.eq("firebase_uid", normalizedOwnerUid).maybeSingle()

        if (error) {
            console.warn(`Failed to load owner user ${normalizedOwnerUid} from Supabase: ${error.message}`)
            return loadOwnerRecordFromMwbe(normalizedOwnerUid)
        }

        if (data) {
            return data
        }

        return loadOwnerRecordFromMwbe(normalizedOwnerUid)
    }

    async function resolveFirebaseOwnerUid(ownerUid) {
        const normalizedOwnerUid = String(ownerUid || "").trim()

        if (!normalizedOwnerUid) {
            return ""
        }

        if (!isUuid(normalizedOwnerUid)) {
            return normalizedOwnerUid
        }

        const owner = await loadOwnerRecord(normalizedOwnerUid)
        return String(owner?.firebase_uid || normalizedOwnerUid).trim()
    }

    async function loadOwnedFirebaseDeviceIds(ownerUid) {
        const normalizedOwnerUid = String(ownerUid || "").trim()

        if (!normalizedOwnerUid) {
            return []
        }

        if (!supabase) {
            return loadOwnedFirebaseDeviceIdsFromMwbe(normalizedOwnerUid)
        }

        const owner = await loadOwnerRecord(normalizedOwnerUid)
        const ownerKeys = [...new Set([
            normalizedOwnerUid,
            owner?.id,
            owner?.firebase_uid,
        ].filter(Boolean))]

        const { data, error } = await supabase
            .from("devices")
            .select("device_id")
            .in("owner_uid", ownerKeys)

        if (error) {
            console.warn(`Failed to load devices for owner ${normalizedOwnerUid} from Supabase: ${error.message}`)
            return loadOwnedFirebaseDeviceIdsFromMwbe(owner?.firebase_uid || normalizedOwnerUid)
        }

        const deviceIds = [...new Set(
            (data || [])
                .map((device) => String(device?.device_id || "").trim())
                .filter(Boolean)
        )]

        if (deviceIds.length > 0) {
            return deviceIds
        }

        return loadOwnedFirebaseDeviceIdsFromMwbe(owner?.firebase_uid || normalizedOwnerUid)
    }

    async function loadKnownFirebaseDeviceIds() {
        const envDeviceIds = String(process.env.FIREBASE_SYNC_DEVICE_IDS || "")
            .split(",")
            .map((deviceId) => deviceId.trim())
            .filter(Boolean)

        if (envDeviceIds.length > 0) {
            return [...new Set(envDeviceIds)]
        }

        if (!supabase) {
            return []
        }

        const { data, error } = await supabase
            .from("devices")
            .select("device_id")

        if (error) {
            throw new Error(`Failed to load known Firebase devices: ${error.message}`)
        }

        return [...new Set(
            (data || [])
                .map((device) => String(device?.device_id || "").trim())
                .filter(Boolean)
        )]
    }

    function normalizeFirebaseRootEntries(rootPayload, config) {
        if (!rootPayload || typeof rootPayload !== "object") {
            return []
        }

        return Object.entries(rootPayload).flatMap(([ownerUid, ownerPayload]) => {
            const normalizedOwnerUid = String(ownerUid || "").trim()
            const devicesPayload = ownerPayload?.[FIREBASE_USER_DEVICES_PATH_SEGMENT]

            if (!normalizedOwnerUid || !devicesPayload || typeof devicesPayload !== "object") {
                return []
            }

            return Object.entries(devicesPayload)
                .map(([deviceId, payload]) => {
                    const normalizedDeviceId = String(deviceId || "").trim()

                    if (!normalizedDeviceId) {
                        return null
                    }

                    return {
                        deviceId: normalizedDeviceId,
                        ownerUid: normalizedOwnerUid,
                        path: buildFirebaseDevicePath(
                            config.deviceRootPath,
                            normalizedOwnerUid,
                            normalizedDeviceId
                        ),
                        payload,
                    }
                })
                .filter(Boolean)
        })
    }

    async function readFirebaseRootEntries(config, options = {}) {
        const rootPayload = await readFirebaseValue(config.deviceRootPath, options)
        return normalizeFirebaseRootEntries(rootPayload, config)
    }

    async function loadFirebaseDeviceEntriesByIds(deviceIds, config, options = {}) {
        const fallbackOwnerUid = String(options.ownerUid || "").trim()
        const uniqueDeviceIds = [...new Set(
            (deviceIds || [])
                .map((deviceId) => String(deviceId || "").trim())
                .filter(Boolean)
        )]

        if (uniqueDeviceIds.length === 0) {
            return []
        }

        const ownerMetadataByDeviceId = await loadDeviceOwnerMetadataMap(uniqueDeviceIds)
        const resolvedEntriesByDeviceId = new Map()
        const unresolvedDeviceIds = []

        const directPathLookups = await Promise.all(uniqueDeviceIds.map(async (deviceId) => {
            const metadata = ownerMetadataByDeviceId.get(deviceId)
            const ownerUidCandidate = String(
                metadata?.owner_uid
                || fallbackOwnerUid
                || ""
            ).trim()

            if (!ownerUidCandidate || ownerUidCandidate === DEFAULT_DEVICE_OWNER_LABELS.owner_uid) {
                return {
                    deviceId,
                    ownerUid: "",
                    path: "",
                    payload: null,
                }
            }

            const resolvedOwnerUid = await resolveFirebaseOwnerUid(ownerUidCandidate)
            const pathToRead = buildFirebaseDevicePath(
                config.deviceRootPath,
                resolvedOwnerUid,
                deviceId
            )

            try {
                return {
                    deviceId,
                    ownerUid: resolvedOwnerUid,
                    path: pathToRead,
                    payload: await readFirebaseValue(pathToRead, {
                        authToken: options.authToken,
                    }),
                }
            } catch (error) {
                return {
                    deviceId,
                    ownerUid: resolvedOwnerUid,
                    path: pathToRead,
                    payload: null,
                    error,
                }
            }
        }))

        directPathLookups.forEach((entry) => {
            if (entry?.payload) {
                resolvedEntriesByDeviceId.set(entry.deviceId, entry)
                return
            }

            unresolvedDeviceIds.push(entry.deviceId)
        })

        if (unresolvedDeviceIds.length === 0 || options.allowRootScan === false) {
            return uniqueDeviceIds
                .map((deviceId) => resolvedEntriesByDeviceId.get(deviceId))
                .filter(Boolean)
        }

        let rootEntries = []

        try {
            rootEntries = await readFirebaseRootEntries(config, {
                authToken: options.authToken,
            })
        } catch (error) {
            if (
                resolvedEntriesByDeviceId.size > 0
                && isFirebasePermissionError(error)
            ) {
                return uniqueDeviceIds
                    .map((deviceId) => resolvedEntriesByDeviceId.get(deviceId))
                    .filter(Boolean)
            }

            throw error
        }
        const rootEntriesByDeviceId = new Map(
            rootEntries.map((entry) => [entry.deviceId, entry])
        )

        unresolvedDeviceIds.forEach((deviceId) => {
            const rootEntry = rootEntriesByDeviceId.get(deviceId)

            if (rootEntry) {
                resolvedEntriesByDeviceId.set(deviceId, rootEntry)
            }
        })

        return uniqueDeviceIds
            .map((deviceId) => resolvedEntriesByDeviceId.get(deviceId))
            .filter(Boolean)
    }

    function filterChangedFirebaseSamples(samples, source) {
        const changedSamples = []
        let skippedUnchanged = 0
        const nextFingerprints = []

        ;(samples || []).forEach((sample) => {
            const seriesKey = createFirebaseSeriesKey(sample, source)
            const fingerprint = normalizeFirebaseDedupValue(sample.metric_type, sample.value)
            const previousFingerprint = state.firebaseSeriesCache[seriesKey]

            if (previousFingerprint === fingerprint) {
                skippedUnchanged += 1
                return
            }

            changedSamples.push(sample)
            nextFingerprints.push({ seriesKey, fingerprint })
        })

        return {
            changedSamples,
            nextFingerprints,
            skippedUnchanged,
        }
    }

    async function syncFirebaseDevicesByIds(deviceIds, config, options = {}) {
        const now = Date.now()
        const uniqueDeviceIds = [...new Set(
            (deviceIds || [])
                .map((deviceId) => String(deviceId || "").trim())
                .filter(Boolean)
        )]
        const devicePayloads = await loadFirebaseDeviceEntriesByIds(deviceIds, config, options)
        const normalizedDevices = devicePayloads.map((devicePayload) => ({
            deviceId: devicePayload.deviceId,
            ownerUid: devicePayload.ownerUid,
            path: devicePayload.path,
            samples: devicePayload.payload
                ? normalizeFirebaseDevicePayload(devicePayload.deviceId, devicePayload.payload, now)
                : [],
        }))

        const samples = normalizedDevices.flatMap((device) => device.samples)
        const {
            changedSamples,
            nextFingerprints,
            skippedUnchanged,
        } = filterChangedFirebaseSamples(samples, config.source)
        const result = changedSamples.length > 0
            ? await ingestSamples(changedSamples, config.source)
            : {
                accepted: [],
                rejected: [],
                pushResult: {
                    pushed: 0,
                    skipped: true,
                    reason: uniqueDeviceIds.length > 0
                        ? (samples.length > 0 ? "no_changed_samples" : "no_valid_samples")
                        : "no_owned_devices",
                },
            }

        nextFingerprints.forEach(({ seriesKey, fingerprint }) => {
            state.firebaseSeriesCache[seriesKey] = fingerprint
        })

        state.lastFirebaseError = null
        state.lastFirebaseSamples = result.accepted
        state.lastFirebaseSync = {
                ownerUid: options.ownerUid || null,
                deviceCount: normalizedDevices.length,
            accepted: result.accepted.length,
            rejected: result.rejected.length,
                path: options.path || config.deviceRootPath,
                source: config.source,
                syncedAt: Date.now(),
            pushResult: result.pushResult,
            skippedUnchanged,
        }

        if (options.ownerUid) {
            state.firebaseOwnerSyncStatus[options.ownerUid] = state.lastFirebaseSync
        }

        return {
            ...state.lastFirebaseSync,
            devices: normalizedDevices.map((device) => ({
                deviceId: device.deviceId,
                path: device.path,
                sampleCount: device.samples.length,
            })),
            samples: result.accepted,
            rejectedSamples: result.rejected,
            pushResult: result.pushResult,
        }
    }

    async function syncFirebaseData(options = {}) {
        const config = getFirebaseConfig()
        if (!firebaseDb && !config.databaseUrl) {
            throw new Error("Firebase is disabled")
        }

        const now = Date.now()
        const requestedOwnerUid = String(options.ownerUid || "").trim()
        const requestedDeviceId = String(options.deviceId || "").trim()

        if (requestedOwnerUid) {
            const resolvedOwnerUid = await resolveFirebaseOwnerUid(requestedOwnerUid)
            const ownedDeviceIds = await loadOwnedFirebaseDeviceIds(requestedOwnerUid)
            return syncFirebaseDevicesByIds(ownedDeviceIds, config, {
                authToken: options.authToken,
                ownerUid: resolvedOwnerUid,
                path: buildFirebaseOwnerDevicesPath(config.deviceRootPath, resolvedOwnerUid || requestedOwnerUid),
            })
        }

        if (requestedDeviceId) {
            return syncFirebaseDevicesByIds([requestedDeviceId], config, {
                authToken: options.authToken,
                path: buildFirebaseDevicePath(config.deviceRootPath, "{owner}", requestedDeviceId),
            })
        }

        const knownDeviceIds = await loadKnownFirebaseDeviceIds()
        if (knownDeviceIds.length > 0) {
            return syncFirebaseDevicesByIds(knownDeviceIds, config, {
                authToken: options.authToken,
                path: joinFirebasePath(config.deviceRootPath, "{known_owners}", FIREBASE_USER_DEVICES_PATH_SEGMENT),
            })
        }

        const pathToRead = config.deviceRootPath
        let devices

        try {
            devices = await readFirebaseValue(pathToRead, {
                authToken: options.authToken,
            })
        } catch (error) {
            if (!isFirebasePermissionError(error)) {
                throw error
            }

            state.lastFirebaseError = "Firebase users root is denied and no known device list is configured"
            state.lastFirebaseSamples = []
            state.lastFirebaseSync = {
                deviceCount: 0,
                accepted: 0,
                rejected: 0,
                path: pathToRead,
                source: config.source,
                syncedAt: Date.now(),
                pushResult: {
                    pushed: 0,
                    skipped: true,
                    reason: "root_path_permission_denied",
                },
                skippedUnchanged: 0,
            }

            return {
                ...state.lastFirebaseSync,
                devices: [],
                samples: [],
                rejectedSamples: [],
                pushResult: state.lastFirebaseSync.pushResult,
            }
        }

        if (!devices || typeof devices !== "object") {
            throw new Error(`No Firebase data found at ${pathToRead}`)
        }

        const normalizedDevices = normalizeFirebaseRootEntries(devices, config).map((entry) => ({
            deviceId: entry.deviceId,
            ownerUid: entry.ownerUid,
            path: entry.path,
            samples: normalizeFirebaseDevicePayload(entry.deviceId, entry.payload, now),
        }))

        const samples = normalizedDevices.flatMap((device) => device.samples)

        if (samples.length === 0) {
            throw new Error(`No supported sensor values found under ${pathToRead}`)
        }

        const {
            changedSamples,
            nextFingerprints,
            skippedUnchanged,
        } = filterChangedFirebaseSamples(samples, config.source)
        const result = changedSamples.length > 0
            ? await ingestSamples(changedSamples, config.source)
            : {
                accepted: [],
                rejected: [],
                pushResult: {
                    pushed: 0,
                    skipped: true,
                    reason: "no_changed_samples",
                },
            }

        nextFingerprints.forEach(({ seriesKey, fingerprint }) => {
            state.firebaseSeriesCache[seriesKey] = fingerprint
        })

        state.lastFirebaseError = null
        state.lastFirebaseSamples = result.accepted
        state.lastFirebaseSync = {
            deviceCount: normalizedDevices.length,
            accepted: result.accepted.length,
            rejected: result.rejected.length,
            path: pathToRead,
            source: config.source,
            syncedAt: Date.now(),
            pushResult: result.pushResult,
            skippedUnchanged,
        }

        return {
            ...state.lastFirebaseSync,
            devices: normalizedDevices.map((device) => ({
                deviceId: device.deviceId,
                path: device.path,
                sampleCount: device.samples.length,
            })),
            samples: result.accepted,
            rejectedSamples: result.rejected,
            pushResult: result.pushResult,
        }
    }

    function scheduleMwbePolling() {
        const config = getMwbeConfig()

        if (!config.url) {
            console.log("MWBE polling disabled: MWBE_API_URL is not configured")
            return
        }

        if (config.syncOnStart) {
            syncMwbeData()
                .then((result) => {
                    console.log(`Initial MWBE sync completed: accepted=${result.accepted.length} rejected=${result.rejected.length}`)
                })
                .catch((error) => {
                    console.error(`Initial MWBE sync failed: ${error.message}`)
                })
        }

        if (!Number.isFinite(config.syncIntervalMs) || config.syncIntervalMs <= 0) {
            console.log("MWBE polling disabled: MWBE_SYNC_INTERVAL_MS <= 0")
            return
        }

        mwbePollTimer = setInterval(async () => {
            try {
                const result = await syncMwbeData()
                console.log(`MWBE sync completed: accepted=${result.accepted.length} rejected=${result.rejected.length}`)
            } catch (error) {
                console.error(`MWBE sync failed: ${error.message}`)
            }
        }, config.syncIntervalMs)

        if (typeof mwbePollTimer.unref === "function") {
            mwbePollTimer.unref()
        }
    }

    function scheduleFirebasePolling() {
        const config = getFirebaseConfig()

        if (!firebaseDb && !config.databaseUrl) {
            console.log("Firebase polling disabled: Firebase is not configured")
            return
        }

        if (config.syncOnStart) {
            syncFirebaseData()
                .then((result) => {
                    console.log(`Initial Firebase sync completed: accepted=${result.accepted} rejected=${result.rejected}`)
                })
                .catch((error) => {
                    state.lastFirebaseError = error.message
                    console.error(`Initial Firebase sync failed: ${error.message}`)
                })
        }

        if (!Number.isFinite(config.syncIntervalMs) || config.syncIntervalMs <= 0) {
            console.log("Firebase polling disabled: FIREBASE_SYNC_INTERVAL_MS <= 0")
            return
        }

        firebasePollTimer = setInterval(async () => {
            try {
                const result = await syncFirebaseData()
                console.log(`Firebase sync completed: accepted=${result.accepted} rejected=${result.rejected}`)
            } catch (error) {
                state.lastFirebaseError = error.message
                console.error(`Firebase sync failed: ${error.message}`)
            }
        }, config.syncIntervalMs)

        if (typeof firebasePollTimer.unref === "function") {
            firebasePollTimer.unref()
        }
    }

    function stopPolling() {
        if (mwbePollTimer) {
            clearInterval(mwbePollTimer)
            mwbePollTimer = null
        }

        if (firebasePollTimer) {
            clearInterval(firebasePollTimer)
            firebasePollTimer = null
        }
    }

    app.use(cors(createCorsOptions()))
    app.use(express.json())

    publishThresholdMetrics()

    app.get("/", (req, res) => {
        res.send("ESG Backend Running")
    })

    app.get("/data", async (req, res) => {
        const config = getFirebaseConfig()
        const authToken = extractFirebaseAuthToken(req)

        if (!firebaseDb && !config.databaseUrl) {
            res.status(503).json({ error: "Firebase is disabled" })
            return
        }

        const explicitPath = String(req.query.path || "").trim()
        const requestedDeviceId = String(req.query.deviceId || "").trim()
        const deviceEntries = explicitPath || !requestedDeviceId
            ? []
            : await loadFirebaseDeviceEntriesByIds([requestedDeviceId], config, { authToken })
        const pathToRead = explicitPath
            || deviceEntries[0]?.path
            || (requestedDeviceId
                ? buildFirebaseDevicePath(config.deviceRootPath, "{owner}", requestedDeviceId)
                : config.deviceRootPath)

        const payload = explicitPath || !requestedDeviceId
            ? await readFirebaseValue(pathToRead, {
                authToken,
            })
            : deviceEntries[0]?.payload || null
        res.json(payload)
    })

    app.get("/iot/metrics", async (req, res) => {
        res.set("Content-Type", registry.contentType)
        res.send(await registry.metrics())
    })

    app.get("/iot/export/:range", async (req, res) => {
        try {
            const metricType = String(req.query.metric_type || "").trim().toLowerCase()

            if (metricType && !METRIC_TYPES.includes(metricType)) {
                res.status(400).json({
                    error: `metric_type must be one of: ${METRIC_TYPES.join(", ")}`,
                })
                return
            }

            const { csv, fileName } = await exportSensorReadingsCsv({
                range: req.params.range,
                sensor_id: String(req.query.sensor_id || "").trim(),
                metric_type: metricType || undefined,
            })

            res.setHeader("Content-Type", "text/csv; charset=utf-8")
            res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
            res.status(200).send(csv)
        } catch (error) {
            const statusCode = String(error.message || "").includes("range must be one of") ? 400 : 500
            console.error(error.message)
            res.status(statusCode).json({ error: error.message })
        }
    })

    app.get("/firebase/status", async (req, res) => {
        res.json({
            config: getFirebaseConfig(),
            lastFirebaseSync: state.lastFirebaseSync,
            lastFirebaseError: state.lastFirebaseError,
            recentSamples: state.lastFirebaseSamples,
            ownerSyncStatus: state.firebaseOwnerSyncStatus,
        })
    })

    app.get("/mcp/status", async (req, res) => {
        const config = getMcpAssistantConfig()

        res.json({
            configured: isMcpAssistantConfigured(config),
            model: config.model,
            serverUrl: config.serverUrl,
            warning: isMcpAssistantConfigured(config)
                ? ""
                : "Set OPENAI_API_KEY and OPENAI_MCP_SERVER_URL in backend/.env to enable the devices-page assistant.",
        })
    })

    app.post("/mcp/ask", async (req, res) => {
        try {
            const question = String(req.body?.question || "").trim()
            const selectedDeviceId = String(req.body?.selectedDeviceId || "").trim()
            const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : []

            if (!question) {
                res.status(400).json({ error: "question is required" })
                return
            }

            const result = await askMcpAssistant({
                question,
                selectedDeviceId,
                deviceIds,
            })

            res.json({
                status: "success",
                ...result,
            })
        } catch (error) {
            const statusCode = Number(error?.statusCode) || Number(error?.response?.status) || 500
            const detail = error?.response?.data
                ? (typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data))
                : error.message

            res.status(statusCode).json({
                error: "Failed to ask MCP assistant",
                detail,
            })
        }
    })

    app.get("/firebase/preview/:deviceId", async (req, res) => {
        const config = getFirebaseConfig()
        const authToken = extractFirebaseAuthToken(req)

        if (!firebaseDb && !config.databaseUrl) {
            res.status(503).json({ error: "Firebase is disabled" })
            return
        }

        try {
            const deviceId = String(req.params.deviceId || "").trim()
            const deviceEntries = await loadFirebaseDeviceEntriesByIds([deviceId], config, { authToken })
            const deviceEntry = deviceEntries[0] || null
            const pathToRead = deviceEntry?.path
                || buildFirebaseDevicePath(config.deviceRootPath, "{owner}", deviceId)
            const payload = deviceEntry?.payload || null

            if (!payload) {
                res.status(404).json({ error: `No Firebase data found at ${pathToRead}` })
                return
            }

            res.json({
                path: pathToRead,
                raw: payload,
                samples: normalizeFirebaseDevicePayload(deviceId, payload),
            })
        } catch (error) {
            res.status(500).json({ error: "Failed to preview Firebase data", detail: error.message })
        }
    })

    app.get("/iot/anomalies", async (req, res) => {
        res.json({
            thresholds: resolveThresholds(),
            lastMwbeSync: state.lastMwbeSync,
            lastMwbeError: state.lastMwbeError,
            recentSamples: state.lastMwbeSamples,
            lastEsgScore: state.lastEsgScore,
        })
    })

    app.get("/esg/status", async (req, res) => {
        try {
            const latestScore = await resolveCurrentEsgScore()

            res.json({
                config: getEsgConfig(),
                latest: latestScore,
                bufferedSamples: state.sampleBuffer.length,
            })
        } catch (error) {
            console.error(`ESG status recovery failed: ${error.message}`)
            res.status(500).json({ error: "Failed to load ESG status", detail: error.message })
        }
    })

    app.get("/mwbe/status", async (req, res) => {
        res.json({
            config: getMwbeConfig(),
            lastMwbeSync: state.lastMwbeSync,
            lastMwbeError: state.lastMwbeError,
            thresholds: resolveThresholds(),
        })
    })

    app.get("/kalshi/status", async (req, res) => {
        res.json({
            config: getPublicKalshiConfig(),
            routes: {
                markets: "GET /kalshi/markets?category=Companies&status=open",
                market: "GET /kalshi/markets/:ticker",
                orderbook: "GET /kalshi/markets/:ticker/orderbook",
                balance: "GET /kalshi/portfolio/balance",
                positions: "GET /kalshi/portfolio/positions",
                orders: "GET /kalshi/portfolio/orders",
                esgTradePlan: "GET /kalshi/esg/trade-plan?ticker=MARKET_TICKER",
                esgTradeOrder: "POST /kalshi/esg/trade-order",
            },
        })
    })

    app.get("/kalshi/markets", async (req, res) => {
        try {
            const requestedCategory = String(req.query?.category || "").trim()
            const data = requestedCategory
                ? await loadCategoryFilteredKalshiMarkets(req.query)
                : await callKalshiApi({
                    endpointPath: "/markets",
                    params: pickKalshiQueryParams(req.query, KALSHI_MARKETS_QUERY_PARAMS),
                })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi markets fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi markets", detail })
        }
    })

    app.get("/kalshi/markets/:ticker", async (req, res) => {
        try {
            const data = await callKalshiApi({
                endpointPath: buildKalshiPath("markets", req.params.ticker),
            })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi market fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi market", detail })
        }
    })

    app.get("/kalshi/markets/:ticker/orderbook", async (req, res) => {
        try {
            const data = await callKalshiApi({
                endpointPath: buildKalshiPath("markets", req.params.ticker, "orderbook"),
                params: pickKalshiQueryParams(req.query, KALSHI_ORDERBOOK_QUERY_PARAMS),
            })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi orderbook fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi orderbook", detail })
        }
    })

    app.get("/kalshi/portfolio/balance", async (req, res) => {
        try {
            const data = await callKalshiApi({
                endpointPath: "/portfolio/balance",
                params: pickKalshiQueryParams(req.query, ["subaccount"]),
                authRequired: true,
            })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi balance fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi balance", detail })
        }
    })

    app.get("/kalshi/portfolio/positions", async (req, res) => {
        try {
            const data = await callKalshiApi({
                endpointPath: "/portfolio/positions",
                params: pickKalshiQueryParams(req.query, KALSHI_PORTFOLIO_QUERY_PARAMS),
                authRequired: true,
            })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi positions fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi positions", detail })
        }
    })

    app.get("/kalshi/portfolio/orders", async (req, res) => {
        try {
            const data = await callKalshiApi({
                endpointPath: "/portfolio/orders",
                params: pickKalshiQueryParams(req.query, KALSHI_PORTFOLIO_QUERY_PARAMS),
                authRequired: true,
            })

            res.json(data)
        } catch (error) {
            const { statusCode, detail } = formatKalshiError(error)
            console.error(`Kalshi orders fetch failed: ${detail}`)
            res.status(statusCode).json({ error: "Failed to fetch Kalshi orders", detail })
        }
    })

    app.get("/kalshi/esg/trade-plan", async (req, res) => {
        try {
            const plan = await buildEsgTradePlan({
                ticker: req.query.ticker,
                count: req.query.count,
                side: req.query.side,
                action: req.query.action,
                subaccount: req.query.subaccount,
            })

            res.json(plan)
        } catch (error) {
            const missingEsg = String(error.message || "").includes("No ESG score is available yet")
            const statusCode = missingEsg || String(error.message || "").includes("ticker is required") ? 400 : 500

            if (statusCode === 500) {
                console.error(`Kalshi ESG trade plan failed: ${error.message}`)
            }

            res.status(statusCode).json({ error: "Failed to build ESG trade plan", detail: error.message })
        }
    })

    app.post("/kalshi/esg/trade-order", async (req, res) => {
        try {
            const payload = req.body || {}
            const plan = await buildEsgTradePlan({
                ticker: payload.ticker ?? req.query.ticker,
                count: payload.count ?? req.query.count,
                side: payload.side ?? req.query.side,
                action: payload.action ?? req.query.action,
                subaccount: payload.subaccount ?? req.query.subaccount,
            })
            const orderResult = await callKalshiApi({
                endpointPath: "/portfolio/orders",
                method: "POST",
                authRequired: true,
                data: plan.orderPreview,
                headers: {
                    "Content-Type": "application/json",
                },
            })

            res.status(201).json({
                status: "success",
                plan,
                order: orderResult,
            })
        } catch (error) {
            const missingEsg = String(error.message || "").includes("No ESG score is available yet")
            const missingTicker = String(error.message || "").includes("ticker is required")
            const { statusCode, detail } = formatKalshiError(error)
            const resolvedStatusCode = missingEsg || missingTicker ? 400 : statusCode

            if (resolvedStatusCode >= 500) {
                console.error(`Kalshi ESG trade order failed: ${detail}`)
            }

            res.status(resolvedStatusCode).json({ error: "Failed to submit ESG trade order", detail })
        }
    })

    app.put("/mwbe/config", async (req, res) => {
        const payload = req.body || {}
        runtimeOverrides.mwbeConfig = {
            ...runtimeOverrides.mwbeConfig,
            ...payload,
        }

        stopPolling()
        scheduleMwbePolling()

        res.json({ status: "success", config: getMwbeConfig() })
    })

    app.get("/iot/thresholds", async (req, res) => {
        res.json({ thresholds: resolveThresholds() })
    })

    app.put("/iot/thresholds", async (req, res) => {
        const payload = req.body || {}

        Object.keys(payload).forEach((metricType) => {
            if (!METRIC_TYPES.includes(metricType)) {
                return
            }

            runtimeOverrides.thresholds[metricType] = {
                ...runtimeOverrides.thresholds[metricType],
                ...payload[metricType],
            }
        })

        publishThresholdMetrics()

        res.json({ status: "success", thresholds: resolveThresholds() })
    })

    app.post("/mwbe/sync", async (req, res) => {
        try {
            const result = await syncMwbeData()
            res.json({
                status: "success",
                accepted: result.accepted.length,
                rejected: result.rejected.length,
                samples: result.accepted,
                rejectedSamples: result.rejected,
                pushResult: result.pushResult,
            })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to sync MWBE data", detail: error.message })
        }
    })

    app.post("/firebase/sync", async (req, res) => {
        try {
            const decodedToken = await verifyFirebaseUserFromRequest(req)
            const requestedOwnerUid = String(req.body?.ownerUid || req.query.ownerUid || "").trim()
            const ownerUid = decodedToken?.uid || requestedOwnerUid
            if (decodedToken?.uid && requestedOwnerUid && requestedOwnerUid !== decodedToken.uid) {
                res.status(403).json({ error: "Authenticated user does not match requested ownerUid" })
                return
            }

            const deviceId = String(req.body?.deviceId || req.query.deviceId || "").trim()
            const result = await syncFirebaseData({
                ownerUid,
                deviceId,
                authToken: extractFirebaseAuthToken(req),
            })

            res.json({
                status: "success",
                ...result,
            })
        } catch (error) {
            state.lastFirebaseError = error.message
            console.error(error.message)
            res.status(Number(error.statusCode) || 500).json({ error: "Failed to sync Firebase data", detail: error.message })
        }
    })

    app.post("/firebase/sync/:deviceId", async (req, res) => {
        try {
            await verifyFirebaseUserFromRequest(req)
            const deviceId = String(req.params.deviceId || "").trim()
            const result = await syncFirebaseData({
                deviceId,
                authToken: extractFirebaseAuthToken(req),
            })

            res.json({
                status: "success",
                ...result,
            })
        } catch (error) {
            state.lastFirebaseError = error.message
            console.error(error.message)
            res.status(Number(error.statusCode) || 500).json({ error: "Failed to sync Firebase data", detail: error.message })
        }
    })

    app.post("/iot/data", async (req, res) => {
        try {
            const { sensor_id, value, metric_type, timestamp, source } = req.body || {}
            const result = await ingestSamples(
                [{ sensor_id, value, metric_type, timestamp }],
                String(source || "manual")
            )

            if (result.accepted.length === 0) {
                res.status(400).json({
                    error: "Missing sensor_id, numeric value, or valid metric_type",
                    rejected: result.rejected,
                })
                return
            }

            res.json({ status: "success", sample: result.accepted[0], pushResult: result.pushResult })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to process iot/data" })
        }
    })

    app.post("/iot/data/batch", async (req, res) => {
        try {
            const payload = req.body || {}
            const samples = Array.isArray(payload.samples) ? payload.samples : []
            const result = await ingestSamples(samples, String(payload.source || "batch"))

            if (result.accepted.length === 0) {
                res.status(400).json({
                    error: "No valid samples were provided",
                    rejected: result.rejected,
                })
                return
            }

            res.json({
                status: "success",
                accepted: result.accepted.length,
                rejected: result.rejected.length,
                samples: result.accepted,
                esg: state.lastEsgScore,
                pushResult: result.pushResult,
            })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to process iot/data/batch" })
        }
    })

    app.post("/iot/dummy", async (req, res) => {
        try {
            const payload = req.body || {}
            const count = Number(payload.count ?? 5)
            const requestSeed = payload.seed
            const requestedMin = payload.min
            const requestedMax = payload.max

            if (!Number.isInteger(count) || count < 1 || count > 100) {
                res.status(400).json({ error: "count must be an integer between 1 and 100" })
                return
            }

            if (
                (requestedMin !== undefined || requestedMax !== undefined)
                && (
                    !Number.isFinite(Number(requestedMin))
                    || !Number.isFinite(Number(requestedMax))
                    || Number(requestedMin) >= Number(requestedMax)
                )
            ) {
                res.status(400).json({ error: "min and max must be finite numbers and min must be less than max" })
                return
            }

            const resolvedSeed = requestSeed === undefined
                ? `${Date.now()}-${Math.random()}`
                : requestSeed
            const random = createSeededRandom(hashSeed(resolvedSeed))
            const samples = []

            for (let index = 1; index <= count; index += 1) {
                const sensorId = `dummy-sensor-${index}`

                METRIC_TYPES.forEach((metricType) => {
                    const threshold = resolveThresholds()[metricType]
                    const range = threshold.max - threshold.min
                    const min = Number.isFinite(Number(requestedMin))
                        ? Number(requestedMin)
                        : threshold.min - range * 0.25
                    const max = Number.isFinite(Number(requestedMax))
                        ? Number(requestedMax)
                        : threshold.max + range * 0.25
                    const value = createRandomValueWithGenerator(min, max, random)

                    samples.push({
                        sensor_id: sensorId,
                        metric_type: metricType,
                        value,
                        timestamp: Date.now(),
                    })
                })
            }

            const result = await ingestSamples(samples, "dummy")

            res.json({
                status: "success",
                generated: result.accepted.length,
                rejected: result.rejected.length,
                seed: String(resolvedSeed),
                samples: result.accepted,
                pushResult: result.pushResult,
            })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to process iot/dummy" })
        }
    })

    return {
        app,
        registry,
        state,
        helpers: {
            getEsgConfig,
            getFirebaseConfig,
            getKalshiConfig,
            buildEsgTradePlan,
            resolveThresholds,
            evaluateAnomaly,
            ingestSamples,
            syncFirebaseData,
            syncMwbeData,
            scheduleFirebasePolling,
            scheduleMwbePolling,
            stopPolling,
        },
    }
}

function startServer(options = {}) {
    const {
        port = Number(process.env.PORT || 5000),
        enablePolling = true,
        ...appOptions
    } = options
    const runtime = createApp(appOptions)
    const server = runtime.app.listen(port, () => {
        console.log(`Server running on port ${port}`)
        if (enablePolling) {
            if (runtime.helpers.getFirebaseConfig().backgroundPollingEnabled) {
                runtime.helpers.scheduleFirebasePolling()
            }
            runtime.helpers.scheduleMwbePolling()
        }
    })

    return {
        ...runtime,
        server,
        close: () => new Promise((resolve, reject) => {
            runtime.helpers.stopPolling()
            server.close((error) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve()
            })
        }),
    }
}

module.exports = {
    DEFAULT_KALSHI_BASE_URL,
    DEFAULT_KALSHI_DEMO_BASE_URL,
    DEFAULT_FIREBASE_DATABASE_URL,
    DEFAULT_FIREBASE_PROJECT_ID,
    DEFAULT_FIREBASE_DEVICE_ROOT_PATH,
    METRIC_TYPES,
    buildSensorReadingsCsv,
    createKalshiSignature,
    normalizeFirebaseDevicePayload,
    normalizeFirebaseTimestamp,
    generateFallbackSensorReadings,
    getKalshiConfig,
    getPublicKalshiConfig,
    getExportWindow,
    createApp,
    startServer,
}

if (require.main === module) {
    startServer()
}
