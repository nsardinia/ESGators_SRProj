const test = require("node:test")
const assert = require("node:assert/strict")

const { startServer } = require("../app")

function hasRemoteWriteConfig() {
    return Boolean(
        process.env.GRAFANA_USERNAME
        && process.env.GRAFANA_API_KEY
        && process.env.GRAFANA_PUSH_URL
    )
}

async function createTestServer() {
    const runtime = startServer({ port: 0, enablePolling: false })
    await new Promise((resolve) => runtime.server.once("listening", resolve))
    const address = runtime.server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    return {
        runtime,
        baseUrl,
        close: () => runtime.close(),
    }
}

test("batch ingestion calculates ESG score and reports remote write status", async () => {
    const server = await createTestServer()
    const now = Date.now()

    try {
        const response = await fetch(`${server.baseUrl}/iot/data/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "test-suite",
                samples: [
                    { sensor_id: "sensor-1", metric_type: "temperature", value: 24, timestamp: now },
                    { sensor_id: "sensor-1", metric_type: "humidity", value: 50, timestamp: now + 1 },
                    { sensor_id: "sensor-2", metric_type: "temperature", value: 36, timestamp: now + 2 },
                ],
            }),
        })

        assert.equal(response.status, 200)

        const body = await response.json()
        assert.equal(body.accepted, 3)
        assert.equal(body.rejected, 0)
        assert.equal(body.esg.sampleCount, 3)
        assert.equal(body.esg.metricScores.temperature, 71.86)
        assert.equal(body.esg.metricScores.humidity, 100)
        assert.equal(body.esg.overall, 85.93)

        if (hasRemoteWriteConfig()) {
            assert.equal(body.pushResult.skipped, false)
            assert.ok(body.pushResult.pushed > 0)
        } else {
            assert.equal(body.pushResult.skipped, true)
            assert.equal(body.pushResult.reason, "missing_remote_write_config")
        }
    } finally {
        await server.close()
    }
})

test("metrics endpoint exposes Prometheus-formatted sensor and ESG values", async () => {
    const server = await createTestServer()
    const now = Date.now()

    try {
        await fetch(`${server.baseUrl}/iot/data`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                sensor_id: "sensor-prom",
                metric_type: "temperature",
                value: 31,
                timestamp: now,
                source: "test-suite",
            }),
        })

        const response = await fetch(`${server.baseUrl}/iot/metrics`)
        assert.equal(response.status, 200)

        const metricsText = await response.text()
        assert.match(metricsText, /sensor_data_metric\{sensor_id="sensor-prom",metric_type="temperature",source="test-suite"\} 31/)
        assert.match(metricsText, /sensor_data_anomaly_flag\{sensor_id="sensor-prom",metric_type="temperature",source="test-suite",severity="warning"\} 1/)
        assert.match(metricsText, /esg_environment_score\{scope="overall"\} 71\.43/)
        assert.match(metricsText, /esg_buffer_size 1/)
    } finally {
        await server.close()
    }
})

test("invalid samples are rejected with 400", async () => {
    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/iot/data/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "test-suite",
                samples: [
                    { sensor_id: "", metric_type: "temperature", value: 20 },
                    { sensor_id: "sensor-x", metric_type: "unknown", value: 20 },
                ],
            }),
        })

        assert.equal(response.status, 400)

        const body = await response.json()
        assert.equal(body.rejected.length, 2)
        assert.match(body.error, /No valid samples/)
    } finally {
        await server.close()
    }
})
