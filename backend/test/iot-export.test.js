const test = require("node:test")
const assert = require("node:assert/strict")

const { createApp, generateFallbackSensorReadings, calculateEsgEnvironmentScore } = require("../index")

class MockSupabaseQuery {
    constructor(rows) {
        this.rows = rows
        this.filters = []
        this.gteFilter = null
        this.sort = null
    }

    gte(column, value) {
        this.gteFilter = { column, value }
        return this
    }

    eq(column, value) {
        this.filters.push({ column, value })
        return this
    }

    order(column, options) {
        this.sort = { column, ascending: options?.ascending !== false }
        return this
    }

    then(resolve, reject) {
        return Promise.resolve(this.execute()).then(resolve, reject)
    }

    execute() {
        let data = [...this.rows]

        if (this.gteFilter) {
            data = data.filter((row) => row[this.gteFilter.column] >= this.gteFilter.value)
        }

        for (const filter of this.filters) {
            data = data.filter((row) => row[filter.column] === filter.value)
        }

        if (this.sort) {
            data.sort((left, right) => {
                const leftValue = left[this.sort.column]
                const rightValue = right[this.sort.column]
                const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
                return this.sort.ascending ? comparison : comparison * -1
            })
        }

        return { data, error: null }
    }
}

class MockSupabaseClient {
    constructor(seedRows = []) {
        this.rows = [...seedRows]
        this.inserted = []
    }

    from(tableName) {
        assert.equal(tableName, "sensor_readings")

        return {
            insert: async (payload) => {
                const row = {
                    id: `row-${this.rows.length + 1}`,
                    created_at: new Date().toISOString(),
                    ...payload,
                }

                this.rows.push(row)
                this.inserted.push(row)
                return { error: null }
            },
            select: () => new MockSupabaseQuery(this.rows),
        }
    }
}

async function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const address = server.address()
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`,
            })
        })
    })
}

test("POST /iot/data stores sensor data in Supabase", async () => {
    const supabase = new MockSupabaseClient()
    const app = createApp({
        firebaseDb: null,
        supabase,
        pushMetricsToGrafana: async () => ({ pushed: 0, skipped: true }),
    })
    const { server, baseUrl } = await listen(app)

    try {
        const response = await fetch(`${baseUrl}/iot/data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sensor_id: "sensor-a",
                metric_type: "temperature",
                value: 24.5,
                recorded_at: "2026-03-12T10:00:00.000Z",
                metadata: { unit: "C" },
            }),
        })

        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { status: "success" })
        assert.equal(supabase.inserted.length, 1)
        assert.equal(supabase.inserted[0].sensor_id, "sensor-a")
        assert.equal(supabase.inserted[0].metric_type, "temperature")
        assert.equal(supabase.inserted[0].value, 24.5)
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})

test("GET /iot/export/day returns CSV attachment", async () => {
    const now = Date.now()
    const supabase = new MockSupabaseClient([
        {
            id: "row-1",
            sensor_id: "sensor-a",
            metric_type: "temperature",
            value: 24.5,
            recorded_at: new Date(now - 60 * 60 * 1000).toISOString(),
            created_at: new Date(now - 60 * 60 * 1000).toISOString(),
        },
        {
            id: "row-2",
            sensor_id: "sensor-b",
            metric_type: "humidity",
            value: 60.2,
            recorded_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ])
    const app = createApp({
        firebaseDb: null,
        supabase,
        pushMetricsToGrafana: async () => ({ pushed: 0, skipped: true }),
    })
    const { server, baseUrl } = await listen(app)

    try {
        const response = await fetch(`${baseUrl}/iot/export/day?sensor_id=sensor-a`)

        assert.equal(response.status, 200)
        assert.match(response.headers.get("content-type"), /^text\/csv/)
        assert.equal(
            response.headers.get("content-disposition"),
            'attachment; filename="sensor-readings-day.csv"'
        )

        const body = await response.text()
        assert.match(body, /id,sensor_id,metric_type,value,recorded_at,created_at/)
        assert.match(body, /sensor-a,temperature,24.5/)
        assert.doesNotMatch(body, /sensor-b/)
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})

test("generateFallbackSensorReadings creates 5-second day samples for all 5 metrics", () => {
    const rows = generateFallbackSensorReadings("day")

    assert.equal(rows.length, 12 * 60 * 12 * 5 * 3)
    assert.deepEqual(
        [...new Set(rows.map((row) => row.sensor_id))].sort(),
        ["sensor1", "sensor2", "sensor3"]
    )
    assert.deepEqual(
        [...new Set(rows.slice(0, 50).map((row) => row.metric_type))].sort(),
        ["air_quality", "humidity", "no2", "noise_levels", "temperature"]
    )
})

test("GET /iot/export/day returns fallback th CSV when DB is empty", async () => {
    const supabase = new MockSupabaseClient([])
    const app = createApp({
        firebaseDb: null,
        supabase,
        pushMetricsToGrafana: async () => ({ pushed: 0, skipped: true }),
    })
    const { server, baseUrl } = await listen(app)

    try {
        const response = await fetch(`${baseUrl}/iot/export/day`)

        assert.equal(response.status, 200)
        const body = await response.text()
        assert.match(body, /id,sensor_id,metric_type,value,recorded_at,created_at/)
        assert.match(body, /sensor1,temperature/)
        assert.match(body, /sensor2,humidity/)
        assert.match(body, /sensor3,air_quality/)
        assert.match(body, /sensor1,no2/)
        assert.match(body, /sensor2,noise_levels/)
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})

test("calculateEsgEnvironmentScore uses AQI, NO2 and Noise weights", () => {
    const score = calculateEsgEnvironmentScore({
        airQuality: 40,
        no2: 30,
        noiseLevels: 20,
    })

    assert.equal(score, 66.7)
})

test("POST /iot/dummy includes esg_environment_score samples", async () => {
    const app = createApp({
        firebaseDb: null,
        supabase: null,
        pushMetricsToGrafana: async () => ({ pushed: 0, skipped: true }),
    })
    const { server, baseUrl } = await listen(app)

    try {
        const response = await fetch(`${baseUrl}/iot/dummy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                count: 1,
                min: 10,
                max: 20,
                seed: "esg-seed",
            }),
        })

        assert.equal(response.status, 200)
        const body = await response.json()
        const esgSample = body.samples.find((sample) => sample.metric_type === "esg_environment_score")

        assert.ok(esgSample)
        assert.equal(esgSample.sensor_id, "dummy-sensor-1")
        assert.equal(typeof esgSample.value, "number")
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})
