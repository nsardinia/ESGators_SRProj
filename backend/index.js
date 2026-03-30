const express = require("express")
const cors = require("cors")
const path = require("node:path")
const axios = require("axios")
const protobuf = require("protobufjs")
const snappy = require("snappy")
const promClient = require("prom-client")
const { createSupabaseFromEnv } = require("./supabase")

let defaultDb = null
try {
    defaultDb = require("./firebase")
} catch (error) {
    console.warn("Firebase disabled:", error.message)
}

const PORT = Number(process.env.PORT || 5000)
const METRIC_TYPES = ["air_quality", "no2", "temperature", "humidity", "noise_levels"]
const EXPORT_WINDOWS = {
    day: { label: "day", days: 1 },
    week: { label: "week", days: 7 },
    month: { label: "month", days: 30 },
}

const sensorDataMetric = new promClient.Gauge({
    name: "sensor_data_metric",
    help: "IoT sensor data by metric type",
    labelNames: ["sensor_id", "metric_type"],
})

const esgEnvironmentScoreMetric = new promClient.Gauge({
    name: "esg_environment_score",
    help: "Calculated ESG environment score by sensor",
    labelNames: ["sensor_id"],
})

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

function createRandomValueWithGenerator(min, max, randomFn) {
    return Number((randomFn() * (max - min) + min).toFixed(2))
}

function calculateEsgEnvironmentScore({ airQuality, no2, noiseLevels }) {
    return Number(
        (
            100 -
            (Number(airQuality) * 0.5 +
                Number(no2) * 0.33 +
                Number(noiseLevels) * 0.17)
        ).toFixed(2)
    )
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

async function pushMetricsToGrafana() {
    const username = process.env.GRAFANA_USERNAME
    const apiKey = process.env.GRAFANA_API_KEY
    const pushUrl = process.env.GRAFANA_PUSH_URL

    if (!username || !apiKey || !pushUrl) {
        console.warn("Grafana push skipped: missing GRAFANA_USERNAME/API_KEY/PUSH_URL")
        return { pushed: 0, skipped: true }
    }

    const metricsJson = await promClient.register.getMetricsAsJSON()
    const timeseries = normalizeSamples(metricsJson)

    if (timeseries.length === 0) {
        return { pushed: 0, skipped: true }
    }

    const WriteRequest = await loadWriteRequestType()
    const payload = WriteRequest.encode({ timeseries }).finish()
    const compressedPayload = await snappy.compress(payload)
    const auth = Buffer.from(`${username}:${apiKey}`).toString("base64")

    try {
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
        })
    } catch (error) {
        const status = error?.response?.status
        const responseBody = error?.response?.data
        const detail = responseBody
            ? (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody))
            : error.message

        throw new Error(
            `Grafana push failed${status ? ` (HTTP ${status})` : ""}: ${detail}`
        )
    }

    console.log(`Pushed metrics to Grafana Cloud: ${timeseries.length} samples`)
    return { pushed: timeseries.length }
}

function getExportWindow(range) {
    const selectedWindow = EXPORT_WINDOWS[range]

    if (!selectedWindow) {
        return null
    }

    return {
        ...selectedWindow,
        since: new Date(Date.now() - selectedWindow.days * 24 * 60 * 60 * 1000),
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
    ]
    const lines = rows.map((row) =>
        headers.map((header) => escapeCsvValue(row[header])).join(",")
    )

    return [headers.join(","), ...lines].join("\n")
}

function generateFallbackSensorReadings(range) {
    const selectedWindow = getExportWindow(range) || EXPORT_WINDOWS.day
    const baseIntervalsPerDay = 12 * 60 * 12
    const metricTypes = METRIC_TYPES
    const sensorIds = ["sensor1", "sensor2", "sensor3"]
    const intervalCount = baseIntervalsPerDay * selectedWindow.days
    const intervalMs = 5 * 1000
    const baseTime = Date.now()
    const rows = []

    for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
        const recordedAt = new Date(baseTime - intervalIndex * intervalMs).toISOString()

        sensorIds.forEach((sensorId, sensorIndex) => {
            metricTypes.forEach((metricType, metricIndex) => {
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
                        baseValueByMetric[metricType] +
                        intervalIndex * metricTrend[metricType] +
                        metricIndex * 0.75 +
                        sensorIndex * 1.35 +
                        oscillation
                    ).toFixed(2)
                )

                rows.push({
                    id: `fallback-${range}-${sensorId}-${metricType}-${intervalIndex + 1}`,
                    sensor_id: sensorId,
                    metric_type: metricType,
                    value,
                    recorded_at: recordedAt,
                    created_at: recordedAt,
                })
            })
        })
    }

    return rows.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))
}

async function storeSensorReading(supabase, payload) {
    if (!supabase) {
        throw new Error(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file."
        )
    }

    const { error } = await supabase.from("sensor_readings").insert(payload)

    if (error) {
        throw new Error(error.message)
    }
}

async function exportSensorReadingsCsv(supabase, options) {
    const selectedWindow = getExportWindow(options.range)

    if (!selectedWindow) {
        throw new Error("range must be one of: day, week, month")
    }

    if (!supabase) {
        return {
            csv: buildSensorReadingsCsv(generateFallbackSensorReadings(options.range)),
            fileName: `sensor-readings-${selectedWindow.label}.csv`,
        }
    }

    let rows

    try {
        let query = supabase
            .from("sensor_readings")
            .select("id, sensor_id, metric_type, value, recorded_at, created_at")
            .gte("recorded_at", selectedWindow.since.toISOString())
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

        rows = data && data.length > 0 ? data : generateFallbackSensorReadings(options.range)
    } catch (error) {
        console.warn(`Export fallback used for ${options.range}: ${error.message}`)
        rows = generateFallbackSensorReadings(options.range)
    }

    return {
        csv: buildSensorReadingsCsv(rows),
        fileName: `sensor-readings-${selectedWindow.label}.csv`,
    }
}

function createApp(options = {}) {
    const app = express()
    const firebaseDb = options.firebaseDb === undefined ? defaultDb : options.firebaseDb
    const supabase = options.supabase === undefined ? createSupabaseFromEnv() : options.supabase
    const pushMetrics = options.pushMetricsToGrafana || pushMetricsToGrafana

    app.use(cors())
    app.use(express.json())

    app.get("/", (req, res) => {
        res.send("ESG Backend Running")
    })

    app.get("/data", async (req, res) => {
        if (!firebaseDb) {
            res.status(503).json({ error: "Firebase is disabled" })
            return
        }

        const snapshot = await firebaseDb.ref("sensor_data").once("value")
        res.json(snapshot.val())
    })

    app.get("/iot/metrics", async (req, res) => {
        res.set("Content-Type", promClient.register.contentType)
        res.send(await promClient.register.metrics())
    })

    app.post("/iot/data", async (req, res) => {
        try {
            const { sensor_id, value, metric_type, recorded_at, metadata } = req.body || {}
            const metricType = String(metric_type ?? "temperature").toLowerCase()
            const recordedAt = recorded_at || new Date().toISOString()

            if (!sensor_id || value === undefined) {
                res.status(400).json({ error: "Missing sensor_id or value" })
                return
            }

            if (!METRIC_TYPES.includes(metricType)) {
                res.status(400).json({
                    error: `metric_type must be one of: ${METRIC_TYPES.join(", ")}`,
                })
                return
            }

            if (!Number.isFinite(Number(value))) {
                res.status(400).json({ error: "value must be a finite number" })
                return
            }

            if (Number.isNaN(Date.parse(recordedAt))) {
                res.status(400).json({ error: "recorded_at must be a valid ISO-8601 date" })
                return
            }

            sensorDataMetric.set({ sensor_id, metric_type: metricType }, Number(value))

            await storeSensorReading(supabase, {
                sensor_id,
                metric_type: metricType,
                value: Number(value),
                recorded_at: new Date(recordedAt).toISOString(),
                metadata: metadata ?? null,
            })
            await pushMetrics()

            res.json({ status: "success" })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to process iot/data" })
        }
    })

    app.get("/iot/export/:range", async (req, res) => {
        try {
            const metricType = req.query.metric_type

            if (metricType && !METRIC_TYPES.includes(String(metricType))) {
                res.status(400).json({
                    error: `metric_type must be one of: ${METRIC_TYPES.join(", ")}`,
                })
                return
            }

            const { csv, fileName } = await exportSensorReadingsCsv(supabase, {
                range: req.params.range,
                sensor_id: req.query.sensor_id,
                metric_type: metricType ? String(metricType).toLowerCase() : undefined,
            })

            res.setHeader("Content-Type", "text/csv; charset=utf-8")
            res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
            res.status(200).send(csv)
        } catch (error) {
            const statusCode = error.message.includes("range must be one of") ? 400 : 500
            console.error(error.message)
            res.status(statusCode).json({ error: error.message })
        }
    })

    app.post("/iot/dummy", async (req, res) => {
        try {
            const payload = req.body || {}
            const count = Number(payload.count ?? 5)
            const min = Number(payload.min ?? 10)
            const max = Number(payload.max ?? 100)
            const requestSeed = payload.seed

            if (!Number.isInteger(count) || count < 1 || count > 100) {
                res.status(400).json({ error: "count must be an integer between 1 and 100" })
                return
            }

            if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
                res.status(400).json({
                    error: "min and max must be numbers and min must be less than max",
                })
                return
            }

            const resolvedSeed =
                requestSeed === undefined ? `${Date.now()}-${Math.random()}` : requestSeed
            const random = createSeededRandom(hashSeed(resolvedSeed))

            const samples = []

            for (let index = 1; index <= count; index += 1) {
                const sensorId = `dummy-sensor-${index}`
                const generatedValues = {}

                METRIC_TYPES.forEach((sampleMetricType) => {
                    const value = createRandomValueWithGenerator(min, max, random)
                    sensorDataMetric.set(
                        { sensor_id: sensorId, metric_type: sampleMetricType },
                        value
                    )
                    generatedValues[sampleMetricType] = value
                    samples.push({
                        sensor_id: sensorId,
                        metric_type: sampleMetricType,
                        value,
                    })
                })

                const esgEnvironmentScore = calculateEsgEnvironmentScore({
                    airQuality: generatedValues.air_quality,
                    no2: generatedValues.no2,
                    noiseLevels: generatedValues.noise_levels,
                })

                esgEnvironmentScoreMetric.set({ sensor_id: sensorId }, esgEnvironmentScore)
                samples.push({
                    sensor_id: sensorId,
                    metric_type: "esg_environment_score",
                    value: esgEnvironmentScore,
                })
            }

            await pushMetrics()

            res.json({
                status: "success",
                generated: samples.length,
                seed: String(resolvedSeed),
                samples,
            })
        } catch (error) {
            console.error(error.message)
            res.status(500).json({ error: "Failed to process iot/dummy" })
        }
    })

    return app
}

module.exports = {
    buildSensorReadingsCsv,
    createApp,
    exportSensorReadingsCsv,
    generateFallbackSensorReadings,
    getExportWindow,
    pushMetricsToGrafana,
    storeSensorReading,
    calculateEsgEnvironmentScore,
}

if (require.main === module) {
    const server = createApp().listen(PORT, () => {
        console.log(`Server running on port ${PORT}`)
    })

    function shutdown() {
        server.close((error) => {
            process.exit(error ? 1 : 0)
        })
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
}
