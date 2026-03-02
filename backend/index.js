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

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT || 5000)
const METRIC_TYPES = ["air_quality", "no2", "temperature", "humidity", "noise_levels"]

const sensorDataMetric = new promClient.Gauge({
    name: "sensor_data_metric",
    help: "IoT sensor data by metric type",
    labelNames: ["sensor_id", "metric_type"],
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

function createRandomValue(min, max) {
    return Number((Math.random() * (max - min) + min).toFixed(2))
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
    res.set("Content-Type", promClient.register.contentType)
    res.send(await promClient.register.metrics())
})

app.post("/iot/data", async (req, res) => {
    try {
        const { sensor_id, value, metric_type } = req.body || {}
        const metricType = String(metric_type ?? "temperature").toLowerCase()

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

        sensorDataMetric.set({ sensor_id, metric_type: metricType }, Number(value))
        await pushMetricsToGrafana()

        res.json({ status: "success" })
    } catch (error) {
        console.error(error.message)
        res.status(500).json({ error: "Failed to process iot/data" })
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
            res.status(400).json({ error: "min and max must be numbers and min must be less than max" })
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
                const value = createRandomValueWithGenerator(min, max, random)
                sensorDataMetric.set({ sensor_id: sensorId, metric_type: metricType }, value)
                samples.push({ sensor_id: sensorId, metric_type: metricType, value })
            })
        }

        await pushMetricsToGrafana()

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

app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`)
})
