require("dotenv").config()

const express = require("express")
const cors = require("cors")
const path = require("node:path")
const axios = require("axios")
const protobuf = require("protobufjs")
const snappy = require("snappy")
const promClient = require("prom-client")

let db = null
try {
    db = require("./firebase")
} catch (error) {
    console.warn("Firebase disabled:", error.message)
}

const METRIC_TYPES = ["air_quality", "no2", "temperature", "humidity", "noise_levels"]
const DEFAULT_THRESHOLDS = {
    air_quality: { min: 0, max: 100, warningMax: 150, criticalMax: 150, unit: "aqi" },
    no2: { min: 0, max: 100, warningMax: 150, criticalMax: 150, unit: "ppb" },
    temperature: { min: 18, max: 28, criticalMin: 18, warningMax: 35, criticalMax: 35, unit: "celsius" },
    humidity: { min: 30, max: 60, criticalMin: 30, warningMax: 80, criticalMax: 80, unit: "percent" },
    noise_levels: { min: 0, max: 75, warningMax: 90, criticalMax: 90, unit: "dba" },
}

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

function createApp() {
    const app = express()
    const registry = new promClient.Registry()
    const state = {
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

    const sensorDataMetric = new promClient.Gauge({
        name: "sensor_data_metric",
        help: "IoT sensor data by metric type",
        labelNames: ["sensor_id", "metric_type", "source"],
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
        labelNames: ["sensor_id", "metric_type", "source", "severity"],
        registers: [registry],
    })

    const sensorDataAnomalyScoreMetric = new promClient.Gauge({
        name: "sensor_data_anomaly_score",
        help: "Relative anomaly score based on deviation from threshold",
        labelNames: ["sensor_id", "metric_type", "source"],
        registers: [registry],
    })

    const sensorDataLastTimestampMetric = new promClient.Gauge({
        name: "sensor_data_last_timestamp_ms",
        help: "Timestamp in milliseconds of the latest ingested sample",
        labelNames: ["sensor_id", "metric_type", "source"],
        registers: [registry],
    })

    const sensorDataAnomalyTotalMetric = new promClient.Counter({
        name: "sensor_data_anomaly_total",
        help: "Total anomaly count by sensor and severity",
        labelNames: ["sensor_id", "metric_type", "source", "severity"],
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
        labelNames: ["sensor_id"],
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

        bufferedSamples.forEach((sample) => {
            metricBuckets[sample.metric_type] = metricBuckets[sample.metric_type] || []
            metricBuckets[sample.metric_type].push(sample.esg_score)

            sensorBuckets[sample.sensor_id] = sensorBuckets[sample.sensor_id] || []
            sensorBuckets[sample.sensor_id].push(sample.esg_score)
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
            esgSensorScoreMetric.set({ sensor_id: sensorId }, rounded)
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
            timeseries.push(createTimeSeries(
                "sensor_data_metric",
                {
                    sensor_id: sample.sensor_id,
                    metric_type: sample.metric_type,
                    source: sample.source,
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

        const metricsJson = await registry.getMetricsAsJSON()
        const timeseries = normalizeSamples(metricsJson).concat(extraTimeSeries)

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

    function createIngestionResult(source, sample) {
        const sensorId = String(sample.sensor_id)
        const metricType = String(sample.metric_type).toLowerCase()
        const numericValue = Number(sample.value)
        const timestamp = Number.isFinite(Number(sample.timestamp))
            ? Math.trunc(Number(sample.timestamp))
            : Date.now()
        const anomaly = evaluateAnomaly(metricType, numericValue)

        sensorDataMetric.set(
            { sensor_id: sensorId, metric_type: metricType, source },
            numericValue
        )
        sensorDataAnomalyScoreMetric.set(
            { sensor_id: sensorId, metric_type: metricType, source },
            anomaly.score
        )
        sensorDataLastTimestampMetric.set(
            { sensor_id: sensorId, metric_type: metricType, source },
            timestamp
        )

        sensorDataAnomalyFlagMetric.set(
            { sensor_id: sensorId, metric_type: metricType, source, severity: "warning" },
            anomaly.isAnomaly && anomaly.severity === "warning" ? 1 : 0
        )
        sensorDataAnomalyFlagMetric.set(
            { sensor_id: sensorId, metric_type: metricType, source, severity: "critical" },
            anomaly.isAnomaly && anomaly.severity === "critical" ? 1 : 0
        )

        if (anomaly.isAnomaly) {
            sensorDataAnomalyTotalMetric.inc({
                sensor_id: sensorId,
                metric_type: metricType,
                source,
                severity: anomaly.severity,
            })
        }

        return {
            sensor_id: sensorId,
            metric_type: metricType,
            value: numericValue,
            source,
            timestamp,
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

    async function ingestSamples(samples, source) {
        const accepted = []
        const rejected = []

        samples.forEach((sample, index) => {
            const metricType = String(sample.metric_type ?? "").toLowerCase()
            const numericValue = Number(sample.value)

            if (!sample.sensor_id || !METRIC_TYPES.includes(metricType) || !Number.isFinite(numericValue)) {
                rejected.push({
                    index,
                    sample,
                    reason: "sample must include sensor_id, numeric value, and supported metric_type",
                })
                return
            }

            accepted.push(createIngestionResult(source, {
                sensor_id: sample.sensor_id,
                metric_type: metricType,
                value: numericValue,
                timestamp: sample.timestamp,
            }))
        })

        let pushResult = { pushed: 0, skipped: true, reason: "no_valid_samples" }

        if (accepted.length > 0) {
            updateEsgState(accepted)
            pushResult = await pushMetricsToGrafana(buildDynamicTimeSeries(accepted))
        }

        return { accepted, rejected, pushResult }
    }

    function getMwbeConfig() {
        return {
            url: process.env.MWBE_API_URL || "",
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

    function stopPolling() {
        if (mwbePollTimer) {
            clearInterval(mwbePollTimer)
            mwbePollTimer = null
        }
    }

    app.use(cors())
    app.use(express.json())

    publishThresholdMetrics()

    app.get("/", (req, res) => {
        res.send("ESG Backend Running")
    })

    app.get("/data", async (req, res) => {
        if (!db) {
            res.status(503).json({ error: "Firebase is disabled" })
            return
        }

        const snapshot = await db.ref("sensor_data").once("value")
        res.json(snapshot.val())
    })

    app.get("/iot/metrics", async (req, res) => {
        res.set("Content-Type", registry.contentType)
        res.send(await registry.metrics())
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
        res.json({
            config: getEsgConfig(),
            latest: state.lastEsgScore,
            bufferedSamples: state.sampleBuffer.length,
        })
    })

    app.get("/mwbe/status", async (req, res) => {
        res.json({
            config: getMwbeConfig(),
            lastMwbeSync: state.lastMwbeSync,
            lastMwbeError: state.lastMwbeError,
            thresholds: resolveThresholds(),
        })
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
            resolveThresholds,
            evaluateAnomaly,
            ingestSamples,
            syncMwbeData,
            scheduleMwbePolling,
            stopPolling,
        },
    }
}

function startServer(options = {}) {
    const { port = Number(process.env.PORT || 5000), enablePolling = true } = options
    const runtime = createApp()
    const server = runtime.app.listen(port, () => {
        console.log(`Server running on port ${port}`)
        if (enablePolling) {
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
    METRIC_TYPES,
    createApp,
    startServer,
}
