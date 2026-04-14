const test = require("node:test")
const assert = require("node:assert/strict")

const {
    DEFAULT_FIREBASE_DATABASE_URL,
    normalizeFirebaseDevicePayload,
    startServer,
} = require("../app")

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

function createMockFirebaseDbWithFailures(valuesByPath, errorsByPath = {}) {
    return {
        ref(path) {
            return {
                async once(eventName) {
                    assert.equal(eventName, "value")

                    if (errorsByPath[path]) {
                        throw errorsByPath[path]
                    }

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
        this.gteFilter = null
        this.sort = null
        this.singleRowMode = false
    }

    select() {
        return this
    }

    eq(column, value) {
        this.filters.push({ column, values: [value] })
        return this
    }

    in(column, values) {
        this.filters.push({ column, values })
        return this
    }

    gte(column, value) {
        this.gteFilter = { column, value }
        return this
    }

    order(column, options) {
        this.sort = { column, ascending: options?.ascending !== false }
        return this
    }

    maybeSingle() {
        this.singleRowMode = true
        return this
    }

    then(resolve, reject) {
        let data = [...this.rows]

        if (this.gteFilter) {
            data = data.filter((row) => row[this.gteFilter.column] >= this.gteFilter.value)
        }

        this.filters.forEach((filter) => {
            data = data.filter((row) => filter.values.includes(row[filter.column]))
        })

        if (this.sort) {
            data.sort((left, right) => {
                const leftValue = left[this.sort.column]
                const rightValue = right[this.sort.column]
                const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
                return this.sort.ascending ? comparison : comparison * -1
            })
        }

        const result = this.singleRowMode
            ? { data: data[0] || null, error: null }
            : { data, error: null }

        return Promise.resolve(result).then(resolve, reject)
    }
}

class MockSupabaseClient {
    constructor(tables = {}) {
        this.tables = Object.fromEntries(
            Object.entries(tables).map(([tableName, rows]) => [tableName, [...rows]])
        )
        this.inserted = []
    }

    from(tableName) {
        return {
            insert: async (payload) => {
                const rows = Array.isArray(payload) ? payload : [payload]
                this.tables[tableName] = this.tables[tableName] || []

                rows.forEach((row, index) => {
                    const nextRow = {
                        id: row.id || `${tableName}-${this.tables[tableName].length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row,
                    }

                    this.tables[tableName].push(nextRow)
                    this.inserted.push(nextRow)
                })

                return { data: rows, error: null }
            },
            select: () => new MockSupabaseQuery(this.tables[tableName] || []),
        }
    }
}

async function createTestServer(options = {}) {
    const runtime = startServer({
        port: 0,
        enablePolling: false,
        supabase: null,
        ...options,
    })
    if (!runtime.server.listening) {
        await new Promise((resolve) => runtime.server.once("listening", resolve))
    }
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
        assert.equal(body.esg.metricScores.temperature, 42.5)
        assert.equal(body.esg.metricScores.humidity, 100)
        assert.equal(body.esg.overall, 46.25)

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

test("batch ingestion persists accepted samples to sensor_readings when Supabase is available", async () => {
    const supabase = new MockSupabaseClient({ sensor_readings: [] })
    const server = await createTestServer({ supabase })
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
                    { sensor_id: "sensor-persist", metric_type: "temperature", value: 24, timestamp: now },
                    { sensor_id: "sensor-persist", metric_type: "humidity", value: 48, timestamp: now + 1 },
                ],
            }),
        })

        assert.equal(response.status, 200)
        assert.equal(supabase.inserted.length, 2)
        assert.equal(supabase.tables.sensor_readings.length, 2)
        assert.equal(supabase.inserted[0].sensor_id, "sensor-persist")
        assert.equal(supabase.inserted[0].metric_type, "temperature")
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
        assert.match(metricsText, /esg_environment_score\{scope="overall"\} 15/)
        assert.match(metricsText, /esg_buffer_size 1/)
    } finally {
        await server.close()
    }
})

test("esg status rebuilds from stored sensor_readings when memory is empty", async () => {
    const now = Date.now()
    const supabase = new MockSupabaseClient({
        sensor_readings: [
            {
                id: "row-1",
                sensor_id: "sensor-restored",
                metric_type: "temperature",
                value: 24,
                recorded_at: new Date(now - 5000).toISOString(),
                created_at: new Date(now - 5000).toISOString(),
            },
            {
                id: "row-2",
                sensor_id: "sensor-restored",
                metric_type: "humidity",
                value: 46,
                recorded_at: new Date(now - 4000).toISOString(),
                created_at: new Date(now - 4000).toISOString(),
            },
            {
                id: "row-3",
                sensor_id: "sensor-restored",
                metric_type: "air_quality",
                value: 42,
                recorded_at: new Date(now - 3000).toISOString(),
                created_at: new Date(now - 3000).toISOString(),
            },
        ],
    })
    const server = await createTestServer({ supabase })

    try {
        const response = await fetch(`${server.baseUrl}/esg/status`)
        assert.equal(response.status, 200)

        const body = await response.json()
        assert.equal(body.latest.overall, 85.84)
        assert.equal(body.bufferedSamples, 3)
        assert.equal(body.latest.metricScores.temperature, 85)
    } finally {
        await server.close()
    }
})

test("export endpoint returns recent in-memory samples as CSV", async () => {
    const server = await createTestServer()
    const now = Date.now()

    try {
        const ingestResponse = await fetch(`${server.baseUrl}/iot/data`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                sensor_id: "sensor-export-memory",
                metric_type: "temperature",
                value: 26.4,
                timestamp: now,
                source: "test-suite",
            }),
        })

        assert.equal(ingestResponse.status, 200)

        const exportResponse = await fetch(`${server.baseUrl}/iot/export/day?sensor_id=sensor-export-memory`)
        assert.equal(exportResponse.status, 200)
        assert.match(exportResponse.headers.get("content-type"), /^text\/csv/)
        assert.equal(
            exportResponse.headers.get("content-disposition"),
            'attachment; filename="sensor-readings-day.csv"'
        )

        const csv = await exportResponse.text()
        assert.match(csv, /id,sensor_id,metric_type,value,recorded_at,created_at,source,owner_uid,owner_email,device_name/)
        assert.match(csv, /sensor-export-memory,temperature,26\.4,/)
        assert.match(csv, /test-suite,unknown,unknown,sensor-export-memory/)
    } finally {
        await server.close()
    }
})

test("export endpoint prefers stored sensor_readings rows when available", async () => {
    const now = Date.now()
    const supabase = new MockSupabaseClient({
        sensor_readings: [
            {
                id: "row-1",
                sensor_id: "sensor-db",
                metric_type: "temperature",
                value: 24.5,
                recorded_at: new Date(now - 60 * 60 * 1000).toISOString(),
                created_at: new Date(now - 60 * 60 * 1000).toISOString(),
            },
            {
                id: "row-2",
                sensor_id: "sensor-db-other",
                metric_type: "humidity",
                value: 60.2,
                recorded_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
                created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            },
        ],
    })
    const server = await createTestServer({ supabase })

    try {
        const response = await fetch(`${server.baseUrl}/iot/export/day?sensor_id=sensor-db`)
        assert.equal(response.status, 200)

        const csv = await response.text()
        assert.match(csv, /sensor-db,temperature,24\.5,/)
        assert.doesNotMatch(csv, /sensor-db-other/)
    } finally {
        await server.close()
    }
})

test("export endpoint falls back to generated sample CSV when no stored or buffered rows exist", async () => {
    const server = await createTestServer({ supabase: null })

    try {
        const response = await fetch(`${server.baseUrl}/iot/export/day`)
        assert.equal(response.status, 200)

        const csv = await response.text()
        assert.match(csv, /id,sensor_id,metric_type,value,recorded_at,created_at,source,owner_uid,owner_email,device_name/)
        assert.match(csv, /sensor1,temperature/)
        assert.match(csv, /sensor2,humidity/)
        assert.match(csv, /sensor3,air_quality/)
    } finally {
        await server.close()
    }
})

test("firebase status exposes a usable default database URL", async () => {
    const server = await createTestServer({ firebaseDb: null })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/status`)
        assert.equal(response.status, 200)

        const body = await response.json()
        assert.equal(body.config.databaseUrl, DEFAULT_FIREBASE_DATABASE_URL)
        assert.equal(body.config.projectId, "senior-project-esgators")
        assert.equal(body.config.backgroundPollingEnabled, false)
        assert.equal(body.config.syncIntervalMs, 5000)
        assert.equal(body.config.syncOnStart, true)
    } finally {
        await server.close()
    }
})

test("cors preflight allows the production frontend origin for Firebase sync", async () => {
    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://es-gators.vercel.app",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization,Content-Type",
            },
        })

        assert.ok(response.status === 204 || response.status === 200)
        assert.equal(
            response.headers.get("access-control-allow-origin"),
            "https://es-gators.vercel.app"
        )
        assert.match(
            response.headers.get("access-control-allow-headers") || "",
            /Authorization/i
        )
    } finally {
        await server.close()
    }
})

test("cors preflight allows the Vercel preview origin for batch ingest", async () => {
    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/iot/data/batch`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://es-gators-git-dev-kimgun3383s-projects.vercel.app",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization,Content-Type",
            },
        })

        assert.ok(response.status === 204 || response.status === 200)
        assert.equal(
            response.headers.get("access-control-allow-origin"),
            "https://es-gators-git-dev-kimgun3383s-projects.vercel.app"
        )
        assert.match(
            response.headers.get("access-control-allow-headers") || "",
            /Authorization/i
        )
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

test("normalizeFirebaseDevicePayload falls back to latest-wrapper readings", () => {
    const samples = normalizeFirebaseDevicePayload("dev_latest_wrapper", {
        latest: {
            deviceId: "dev_latest_wrapper",
            temperatureC: 24.6,
            humidityPct: 51.2,
            updatedAt: "2026-04-12T14:20:00.000Z",
            status: "online",
        },
    }, 1767225600000)

    assert.deepEqual(samples, [
        {
            sensor_id: "dev_latest_wrapper",
            metric_type: "temperature",
            value: 24.6,
            timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
        },
        {
            sensor_id: "dev_latest_wrapper",
            metric_type: "humidity",
            value: 51.2,
            timestamp: Date.parse("2026-04-12T14:20:00.000Z"),
        },
    ])
})

test("firebase sync endpoint ingests mapped RTDB device data", async () => {
    const deviceId = "dev_472584440bca1b56b0518a6620641d39"
    const ownerUid = "firebase-user-telemetry"
    const firebaseDb = createMockFirebaseDb({
        users: {
            [ownerUid]: {
                devices: {
                    [deviceId]: {
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
        [`users/${ownerUid}/devices/${deviceId}`]: {
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
        assert.match(metricsText, new RegExp(`esg_sensor_score\\{sensor_id="${deviceId}",owner_uid="${ownerUid}",owner_email="${ownerEmail}",device_name="Lab Greenhouse"\\} 82\\.09`))
    } finally {
        await server.close()
    }
})

test("firebase sync endpoint only ingests devices owned by the requested ownerUid", async () => {
    const ownerUid = "firebase-user-a"
    const ownedDeviceId = "dev_owner_a_node"
    const otherDeviceId = "dev_owner_b_node"
    const firebaseDb = createMockFirebaseDb({
        [`users/${ownerUid}/devices/${ownedDeviceId}`]: {
            sht30: {
                latest: {
                    deviceId: ownedDeviceId,
                    temperatureC: 23.5,
                    humidityPct: 48.5,
                    updatedAtMs: 1234,
                },
            },
        },
        [`users/firebase-user-b/devices/${otherDeviceId}`]: {
            sht30: {
                latest: {
                    deviceId: otherDeviceId,
                    temperatureC: 31.2,
                    humidityPct: 65.2,
                    updatedAtMs: 1234,
                },
            },
        },
    })
    const supabase = new MockSupabaseClient({
        users: [
            {
                id: "2f909e5f-d270-4879-a6ac-e04818a11234",
                email: "owner-a@example.com",
                firebase_uid: ownerUid,
            },
        ],
        devices: [
            {
                device_id: ownedDeviceId,
                owner_uid: ownerUid,
                name: "Owner A Node",
            },
            {
                device_id: otherDeviceId,
                owner_uid: "firebase-user-b",
                name: "Owner B Node",
            },
        ],
    })
    const server = await createTestServer({ firebaseDb, supabase })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerUid }),
        })

        assert.equal(response.status, 200)
        const body = await response.json()

        assert.equal(body.ownerUid, ownerUid)
        assert.equal(body.deviceCount, 1)
        assert.equal(body.accepted, 2)
        assert.deepEqual(body.devices.map((device) => device.deviceId), [ownedDeviceId])
        assert.ok(body.samples.every((sample) => sample.sensor_id === ownedDeviceId))

        const metricsResponse = await fetch(`${server.baseUrl}/iot/metrics`)
        const metricsText = await metricsResponse.text()

        assert.match(
            metricsText,
            new RegExp(`sensor_data_metric\\{sensor_id="${ownedDeviceId}",metric_type="temperature",source="firebase-rtdb",owner_uid="${ownerUid}",owner_email="owner-a@example.com",device_name="Owner A Node"\\} 23\\.5`)
        )
        assert.doesNotMatch(metricsText, new RegExp(otherDeviceId))
    } finally {
        await server.close()
    }
})

test("firebase sync resolves firebase_uid through MWBE when Supabase is unavailable", async () => {
    const ownerId = "3f913820-5560-414d-b15b-5cb84f0e2e11"
    const ownerFirebaseUid = "C7q0dcT3nggvPiw7G8qZBs6Bpy52"
    const deviceId = "dev_mwbe_owner_lookup"
    const firebaseDb = createMockFirebaseDb({
        [`users/${ownerFirebaseUid}/devices/${deviceId}`]: {
            sht30: {
                latest: {
                    deviceId,
                    temperatureC: 21.75,
                    humidityPct: 46.25,
                    updatedAtMs: 1234,
                },
            },
        },
    })
    const mwbeHttpClient = async (request) => {
        const normalizedUrl = String(request?.url || "")

        if (normalizedUrl.endsWith("/users")) {
            return {
                data: {
                    users: [
                        {
                            id: ownerId,
                            email: "nicholassardinia@ufl.edu",
                            name: "Bob Developer",
                            firebase_uid: ownerFirebaseUid,
                        },
                    ],
                },
            }
        }

        if (normalizedUrl.endsWith("/devices/owned")) {
            assert.equal(request?.params?.ownerUid, ownerId)

            return {
                data: {
                    devices: [
                        {
                            deviceId,
                            name: "MWBE fallback node",
                            description: "fallback lookup",
                            status: "active",
                        },
                    ],
                },
            }
        }

        throw new Error(`Unhandled MWBE request: ${normalizedUrl}`)
    }
    const server = await createTestServer({ firebaseDb, supabase: null, mwbeHttpClient })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerUid: ownerId }),
        })

        assert.equal(response.status, 200)
        const body = await response.json()

        assert.equal(body.ownerUid, ownerFirebaseUid)
        assert.equal(body.deviceCount, 1)
        assert.equal(body.accepted, 2)
        assert.equal(body.path, `users/${ownerFirebaseUid}/devices`)
        assert.deepEqual(body.devices.map((device) => device.deviceId), [deviceId])
        assert.ok(body.samples.every((sample) => sample.sensor_id === deviceId))
    } finally {
        await server.close()
    }
})

test("firebase sync skips unchanged samples on subsequent polls", async () => {
    const deviceId = "dev_repeat_same_value"
    const ownerUid = "firebase-user-repeat"
    const firebaseDb = createMockFirebaseDb({
        users: {
            [ownerUid]: {
                devices: {
                    [deviceId]: {
                        sht30: {
                            latest: {
                                deviceId,
                                temperatureC: 24.25,
                                humidityPct: 51.75,
                                updatedAtMs: 1234,
                            },
                        },
                    },
                },
            },
        },
    })
    const server = await createTestServer({ firebaseDb })

    try {
        const firstResponse = await fetch(`${server.baseUrl}/firebase/sync/${deviceId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        })
        assert.equal(firstResponse.status, 200)

        const secondResponse = await fetch(`${server.baseUrl}/firebase/sync/${deviceId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        })
        assert.equal(secondResponse.status, 200)

        const secondBody = await secondResponse.json()
        assert.equal(secondBody.accepted, 0)
        assert.equal(secondBody.rejected, 0)
        assert.equal(secondBody.skippedUnchanged, 2)
        assert.equal(secondBody.pushResult.reason, "no_changed_samples")
    } finally {
        await server.close()
    }
})

test("firebase sync can read owner device paths with a Firebase ID token when admin auth is unavailable", async () => {
    const deviceId = "dev_token_sync"
    const ownerFirebaseUid = "owner-123"
    const firebaseHttpClient = async (request) => {
        assert.equal(request.method, "GET")
        assert.equal(request.params.auth, "firebase-id-token")
        assert.equal(request.headers.Authorization, "Bearer firebase-id-token")
        assert.equal(
            request.url,
            `${DEFAULT_FIREBASE_DATABASE_URL}/users/${ownerFirebaseUid}/devices/${deviceId}.json`
        )

        return {
            data: {
                sht30: {
                    latest: {
                        deviceId,
                        temperatureC: 22.4,
                        humidityPct: 48.6,
                        updatedAtMs: 1712970001000,
                    },
                },
            },
        }
    }
    const mwbeHttpClient = async (request) => {
        const normalizedUrl = String(request?.url || "")

        if (normalizedUrl.endsWith("/devices/owned")) {
            assert.equal(request?.params?.ownerUid, ownerFirebaseUid)

            return {
                data: {
                    devices: [
                        {
                            deviceId,
                            name: "Token-backed node",
                            description: "Reads with Firebase ID token",
                            status: "active",
                        },
                    ],
                },
            }
        }

        throw new Error(`Unhandled request: ${normalizedUrl}`)
    }
    const server = await createTestServer({
        firebaseDb: null,
        supabase: null,
        mwbeHttpClient,
        firebaseHttpClient,
    })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer firebase-id-token",
            },
            body: JSON.stringify({ ownerUid: ownerFirebaseUid }),
        })

        assert.equal(response.status, 200)
        const body = await response.json()

        assert.equal(body.ownerUid, ownerFirebaseUid)
        assert.equal(body.deviceCount, 1)
        assert.equal(body.accepted, 2)
        assert.equal(body.path, `users/${ownerFirebaseUid}/devices`)
        assert.deepEqual(
            body.samples.map((sample) => sample.metric_type).sort(),
            ["humidity", "temperature"]
        )
    } finally {
        await server.close()
    }
})

test("firebase sync falls back to known device ids when user root is denied", async () => {
    const firstDeviceId = "dev_known_a"
    const secondDeviceId = "dev_known_b"
    const firebaseDb = createMockFirebaseDbWithFailures(
        {
            [`users/owner-a/devices/${firstDeviceId}`]: {
                sht30: {
                    latest: {
                        deviceId: firstDeviceId,
                        temperatureC: 22.1,
                        humidityPct: 41.5,
                        updatedAtMs: 1234,
                    },
                },
            },
            [`users/owner-b/devices/${secondDeviceId}`]: {
                no2: {
                    latest: {
                        deviceId: secondDeviceId,
                        raw: 120,
                        updatedAtMs: 1234,
                    },
                },
                sound: {
                    latest: {
                        deviceId: secondDeviceId,
                        raw: 61,
                        updatedAtMs: 1234,
                    },
                },
            },
        },
        {
            users: Object.assign(new Error("Request failed with status code 401"), {
                response: {
                    status: 401,
                    data: { error: "Permission denied" },
                },
            }),
        }
    )
    const supabase = new MockSupabaseClient({
        devices: [
            { device_id: firstDeviceId, owner_uid: "owner-a", name: "Known A" },
            { device_id: secondDeviceId, owner_uid: "owner-b", name: "Known B" },
        ],
        users: [],
    })
    const server = await createTestServer({ firebaseDb, supabase })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        })

        assert.equal(response.status, 200)
        const body = await response.json()

        assert.equal(body.deviceCount, 2)
        assert.equal(body.accepted, 4)
        assert.equal(body.path, "users/{known_owners}/devices")
        assert.deepEqual(
            body.devices.map((device) => device.deviceId).sort(),
            [firstDeviceId, secondDeviceId]
        )
    } finally {
        await server.close()
    }
})

test("firebase sync skips instead of failing when user root is denied and no known devices exist", async () => {
    const firebaseDb = createMockFirebaseDbWithFailures(
        {},
        {
            users: Object.assign(new Error("Request failed with status code 401"), {
                response: {
                    status: 401,
                    data: { error: "Permission denied" },
                },
            }),
        }
    )
    const server = await createTestServer({ firebaseDb, supabase: null })

    try {
        const response = await fetch(`${server.baseUrl}/firebase/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        })

        assert.equal(response.status, 200)
        const body = await response.json()

        assert.equal(body.accepted, 0)
        assert.equal(body.rejected, 0)
        assert.equal(body.deviceCount, 0)
        assert.equal(body.pushResult.reason, "root_path_permission_denied")
        assert.deepEqual(body.devices, [])
    } finally {
        await server.close()
    }
})

test("mcp status reports setup warning when OpenAI MCP env is missing", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    const originalServerUrl = process.env.OPENAI_MCP_SERVER_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MCP_SERVER_URL

    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/mcp/status`)
        assert.equal(response.status, 200)

        const body = await response.json()
        assert.equal(body.configured, false)
        assert.match(body.warning, /OPENAI_API_KEY/)
    } finally {
        await server.close()
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY
        } else {
            process.env.OPENAI_API_KEY = originalApiKey
        }
        if (originalServerUrl === undefined) {
            delete process.env.OPENAI_MCP_SERVER_URL
        } else {
            process.env.OPENAI_MCP_SERVER_URL = originalServerUrl
        }
    }
})

test("mcp ask returns 503 when OpenAI MCP env is missing", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    const originalServerUrl = process.env.OPENAI_MCP_SERVER_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MCP_SERVER_URL

    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/mcp/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: "Which device looks unhealthy?",
                deviceIds: ["dev_alpha"],
                selectedDeviceId: "dev_alpha",
            }),
        })

        assert.equal(response.status, 503)
        const body = await response.json()
        assert.match(body.detail, /OPENAI_API_KEY/)
    } finally {
        await server.close()
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY
        } else {
            process.env.OPENAI_API_KEY = originalApiKey
        }
        if (originalServerUrl === undefined) {
            delete process.env.OPENAI_MCP_SERVER_URL
        } else {
            process.env.OPENAI_MCP_SERVER_URL = originalServerUrl
        }
    }
})
