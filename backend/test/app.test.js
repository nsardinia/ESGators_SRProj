const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeFirebaseDevicePayload, startServer } = require("../app")

delete process.env.GRAFANA_USERNAME
delete process.env.GRAFANA_API_KEY
delete process.env.GRAFANA_PUSH_URL

function hasRemoteWriteConfig() {
    return Boolean(
        process.env.GRAFANA_USERNAME
        && process.env.GRAFANA_API_KEY
        && process.env.GRAFANA_PUSH_URL
    )
}

function createMockFirebaseDb(valuesByPath) {
    return {
        ref(path) {
            return {
                async once(eventName) {
                    assert.equal(eventName, "value")
                    return {
                        val() {
                            return valuesByPath[path] ?? null
                        },
                    }
                },
            }
        },
    }
}

class MockSupabaseQuery {
    constructor(rows) {
        this.rows = rows
        this.filters = []
    }

    select() {
        return this
    }

    in(column, values) {
        this.filters.push({ column, values })
        return this
    }

    then(resolve, reject) {
        let data = [...this.rows]

        this.filters.forEach((filter) => {
            data = data.filter((row) => filter.values.includes(row[filter.column]))
        })

        return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
}

class MockSupabaseClient {
    constructor(tables = {}) {
        this.tables = tables
    }

    from(tableName) {
        return new MockSupabaseQuery(this.tables[tableName] || [])
    }
}

async function createTestServer(options = {}) {
    const runtime = startServer({
        port: 0,
        enablePolling: false,
        supabase: null,
        ...options,
    })
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
        assert.match(metricsText, /sensor_data_metric\{sensor_id="sensor-prom",metric_type="temperature",source="test-suite",owner_uid="unknown",owner_email="unknown",device_name="sensor-prom"\} 31/)
        assert.match(metricsText, /sensor_data_anomaly_flag\{sensor_id="sensor-prom",metric_type="temperature",source="test-suite",owner_uid="unknown",owner_email="unknown",device_name="sensor-prom",severity="warning"\} 1/)
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

test("normalizeFirebaseDevicePayload maps device export shape into ingestible samples", () => {
    const samples = normalizeFirebaseDevicePayload("dev_472584440bca1b56b0518a6620641d39", {
        no2: {
            latest: {
                deviceId: "dev_472584440bca1b56b0518a6620641d39",
                raw: 3709,
                updatedAtMs: 2685761,
            },
        },
        sht30: {
            latest: {
                deviceId: "dev_472584440bca1b56b0518a6620641d39",
                humidityPct: 49.45144,
                temperatureC: 28.87732,
                updatedAtMs: 2690353,
            },
        },
        sound: {
            latest: {
                deviceId: "dev_472584440bca1b56b0518a6620641d39",
                raw: 0,
                updatedAtMs: 2688330,
            },
        },
    }, 1767225600000)

    assert.equal(samples.length, 4)
    assert.deepEqual(
        samples.map((sample) => sample.metric_type).sort(),
        ["humidity", "no2", "noise_levels", "temperature"]
    )
    assert.ok(samples.every((sample) => sample.sensor_id === "dev_472584440bca1b56b0518a6620641d39"))
    assert.ok(samples.every((sample) => sample.timestamp === 1767225600000))
})

test("firebase sync endpoint ingests mapped RTDB device data", async () => {
    const deviceId = "dev_472584440bca1b56b0518a6620641d39"
    const firebaseDb = createMockFirebaseDb({
        [`devices/${deviceId}`]: {
            no2: {
                latest: {
                    deviceId,
                    firebaseUid: `device:${deviceId}`,
                    raw: 3709,
                    unit: "adc_raw",
                    updatedAtMs: 2685761,
                },
            },
            sht30: {
                latest: {
                    deviceId,
                    firebaseUid: `device:${deviceId}`,
                    humidityPct: 49.45144,
                    temperatureC: 28.87732,
                    updatedAtMs: 2690353,
                },
            },
            sound: {
                latest: {
                    deviceId,
                    firebaseUid: `device:${deviceId}`,
                    raw: 0,
                    unit: "adc_raw",
                    updatedAtMs: 2688330,
                },
            },
        },
    })
    const server = await createTestServer({ firebaseDb })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync/${deviceId}`, {
            method: "POST",
        })

        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.status, "success")
        assert.equal(body.accepted, 4)
        assert.equal(body.rejected, 0)
        assert.deepEqual(
            body.samples.map((sample) => sample.metric_type).sort(),
            ["humidity", "no2", "noise_levels", "temperature"]
        )

        const metricsResponse = await fetch(`${server.baseUrl}/iot/metrics`)
        const metricsText = await metricsResponse.text()

        assert.match(metricsText, new RegExp(`sensor_data_metric\\{sensor_id="${deviceId}",metric_type="temperature",source="firebase-rtdb",owner_uid="unknown",owner_email="unknown",device_name="${deviceId}"\\} 28\\.87732`))
        assert.match(metricsText, new RegExp(`sensor_data_metric\\{sensor_id="${deviceId}",metric_type="humidity",source="firebase-rtdb",owner_uid="unknown",owner_email="unknown",device_name="${deviceId}"\\} 49\\.45144`))
        assert.match(metricsText, new RegExp(`sensor_data_metric\\{sensor_id="${deviceId}",metric_type="no2",source="firebase-rtdb",owner_uid="unknown",owner_email="unknown",device_name="${deviceId}"\\} 3709`))
        assert.match(metricsText, new RegExp(`sensor_data_metric\\{sensor_id="${deviceId}",metric_type="noise_levels",source="firebase-rtdb",owner_uid="unknown",owner_email="unknown",device_name="${deviceId}"\\} 0`))
    } finally {
        await server.close()
    }
})

test("firebase sync endpoint enriches metrics with Supabase owner labels", async () => {
    const deviceId = "dev_owned_node_1"
    const ownerUid = "firebase-user-123"
    const ownerEmail = "owner@example.com"
    const firebaseDb = createMockFirebaseDb({
        [`devices/${deviceId}`]: {
            sht30: {
                latest: {
                    deviceId,
                    temperatureC: 24.25,
                    humidityPct: 44.5,
                    updatedAtMs: 2690353,
                },
            },
        },
    })
    const supabase = new MockSupabaseClient({
        devices: [
            {
                device_id: deviceId,
                owner_uid: ownerUid,
                name: "Lab Greenhouse",
            },
        ],
        users: [
            {
                id: "f1c296da-3919-4d0b-a7a0-6027f682fe8d",
                email: ownerEmail,
                firebase_uid: ownerUid,
            },
        ],
    })
    const server = await createTestServer({ firebaseDb, supabase })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync/${deviceId}`, {
            method: "POST",
        })

        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.accepted, 2)
        assert.equal(body.samples[0].owner_uid, ownerUid)
        assert.equal(body.samples[0].owner_email, ownerEmail)
        assert.equal(body.samples[0].device_name, "Lab Greenhouse")

        const metricsResponse = await fetch(`${server.baseUrl}/iot/metrics`)
        const metricsText = await metricsResponse.text()

        assert.match(metricsText, new RegExp(`sensor_data_metric\\{sensor_id="${deviceId}",metric_type="temperature",source="firebase-rtdb",owner_uid="${ownerUid}",owner_email="${ownerEmail}",device_name="Lab Greenhouse"\\} 24\\.25`))
        assert.match(metricsText, new RegExp(`esg_sensor_score\\{sensor_id="${deviceId}",owner_uid="${ownerUid}",owner_email="${ownerEmail}",device_name="Lab Greenhouse"\\} 100`))
    } finally {
        await server.close()
    }
})
