const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")

const {
    DEFAULT_KALSHI_BASE_URL,
    DEFAULT_KALSHI_DEMO_BASE_URL,
    startServer,
} = require("../app")

const KALSHI_ENV_KEYS = [
    "KALSHI_ENV",
    "KALSHI_ENVIRONMENT",
    "KALSHI_API_BASE_URL",
    "KALSHI_API_KEY_ID",
    "KALSHI_ACCESS_KEY",
    "KALSHI_PRIVATE_KEY_PATH",
    "KALSHI_PRIVATE_KEY_PEM",
    "KALSHI_PRIVATE_KEY_PEM_BASE64",
    "KALSHI_PRIVATE_KEY_BASE64",
    "KALSHI_API_TIMEOUT_MS",
    "KALSHI_SIGN_PUBLIC_REQUESTS",
]

function snapshotKalshiEnv() {
    return Object.fromEntries(KALSHI_ENV_KEYS.map((key) => [key, process.env[key]]))
}

function restoreKalshiEnv(snapshot) {
    KALSHI_ENV_KEYS.forEach((key) => {
        if (snapshot[key] === undefined) {
            delete process.env[key]
            return
        }

        process.env[key] = snapshot[key]
    })
}

function clearKalshiEnv() {
    KALSHI_ENV_KEYS.forEach((key) => {
        delete process.env[key]
    })
}

async function createTestServer(options = {}) {
    const runtime = startServer({
        port: 0,
        enablePolling: false,
        firebaseDb: null,
        supabase: null,
        ...options,
    })
    await new Promise((resolve) => runtime.server.once("listening", resolve))
    const address = runtime.server.address()

    return {
        runtime,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => runtime.close(),
    }
}

test("GET /kalshi/status exposes config without secrets", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    process.env.KALSHI_ENVIRONMENT = "demo"
    const server = await createTestServer()

    try {
        const response = await fetch(`${server.baseUrl}/kalshi/status`)

        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.config.baseUrl, DEFAULT_KALSHI_DEMO_BASE_URL)
        assert.equal(body.config.authConfigured, false)
        assert.equal(body.config.hasApiKeyId, false)
        assert.equal(body.config.hasPrivateKey, false)
        assert.equal(body.config.privateKeySource, "none")
        assert.equal(body.config.apiKeyId, undefined)
        assert.equal(body.config.privateKeyPem, undefined)
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("GET /kalshi/markets proxies public market data without credentials", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    const calls = []
    const server = await createTestServer({
        kalshiHttpClient: async (config) => {
            calls.push(config)
            return {
                data: {
                    markets: [{ ticker: "KXHIGHNY-TEST", status: "open" }],
                    cursor: "",
                },
            }
        },
    })

    try {
        const response = await fetch(
            `${server.baseUrl}/kalshi/markets?series_ticker=KXHIGHNY&status=open&ignored=no`
        )

        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.markets[0].ticker, "KXHIGHNY-TEST")
        assert.equal(calls.length, 1)
        assert.equal(calls[0].method, "GET")
        assert.equal(calls[0].url, `${DEFAULT_KALSHI_BASE_URL}/markets`)
        assert.deepEqual(calls[0].params, {
            series_ticker: "KXHIGHNY",
            status: "open",
        })
        assert.deepEqual(calls[0].headers, {})
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("GET /kalshi/markets/:ticker/orderbook proxies orderbook data", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    const calls = []
    const server = await createTestServer({
        kalshiHttpClient: async (config) => {
            calls.push(config)
            return {
                data: {
                    orderbook_fp: {
                        yes_dollars: [["0.5000", "10.00"]],
                        no_dollars: [],
                    },
                },
            }
        },
    })

    try {
        const response = await fetch(`${server.baseUrl}/kalshi/markets/KXHIGHNY-TEST/orderbook?depth=5`)

        assert.equal(response.status, 200)
        const body = await response.json()
        assert.deepEqual(body.orderbook_fp.yes_dollars, [["0.5000", "10.00"]])
        assert.equal(calls.length, 1)
        assert.equal(calls[0].url, `${DEFAULT_KALSHI_BASE_URL}/markets/KXHIGHNY-TEST/orderbook`)
        assert.deepEqual(calls[0].params, { depth: "5" })
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("GET /kalshi/portfolio/balance signs authenticated Kalshi requests", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
    })
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" })
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" })
    const calls = []

    process.env.KALSHI_API_BASE_URL = "https://example.test/trade-api/v2"
    process.env.KALSHI_API_KEY_ID = "test-key-id"
    process.env.KALSHI_PRIVATE_KEY_PEM = privateKeyPem

    const server = await createTestServer({
        kalshiHttpClient: async (config) => {
            calls.push(config)
            return { data: { balance: 12345 } }
        },
    })

    try {
        const response = await fetch(`${server.baseUrl}/kalshi/portfolio/balance?subaccount=0`)

        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { balance: 12345 })
        assert.equal(calls.length, 1)
        assert.equal(calls[0].url, "https://example.test/trade-api/v2/portfolio/balance")
        assert.deepEqual(calls[0].params, { subaccount: "0" })
        assert.equal(calls[0].headers["KALSHI-ACCESS-KEY"], "test-key-id")
        assert.match(calls[0].headers["KALSHI-ACCESS-TIMESTAMP"], /^\d+$/)
        assert.match(calls[0].headers["KALSHI-ACCESS-SIGNATURE"], /^[A-Za-z0-9+/=]+$/)

        const verifier = crypto.createVerify("RSA-SHA256")
        verifier.update(
            `${calls[0].headers["KALSHI-ACCESS-TIMESTAMP"]}GET/trade-api/v2/portfolio/balance`
        )
        verifier.end()

        assert.equal(
            verifier.verify(
                {
                    key: publicKeyPem,
                    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
                },
                Buffer.from(calls[0].headers["KALSHI-ACCESS-SIGNATURE"], "base64")
            ),
            true
        )
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("GET /kalshi/portfolio/balance requires Kalshi credentials", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    let called = false
    const server = await createTestServer({
        kalshiHttpClient: async () => {
            called = true
            return { data: {} }
        },
    })

    try {
        const response = await fetch(`${server.baseUrl}/kalshi/portfolio/balance`)

        assert.equal(response.status, 503)
        const body = await response.json()
        assert.match(body.detail, /Kalshi auth is not configured/)
        assert.equal(called, false)
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("GET /kalshi/esg/trade-plan builds a bullish demo plan from a healthy ESG score", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    const calls = []
    const server = await createTestServer({
        kalshiHttpClient: async (config) => {
            calls.push(config)

            if (config.url.endsWith("/markets/KXESG-1")) {
                return {
                    data: {
                        ticker: "KXESG-1",
                        title: "Will the ESG demo stay healthy?",
                        status: "open",
                        yes_ask: 49,
                        no_ask: 51,
                        last_price: 48,
                    },
                }
            }

            if (config.url.endsWith("/markets/KXESG-1/orderbook")) {
                return {
                    data: {
                        orderbook_fp: {
                            yes_dollars: [["0.4900", "25.00"]],
                            no_dollars: [["0.5100", "10.00"]],
                        },
                    },
                }
            }

            throw new Error(`Unexpected Kalshi URL: ${config.url}`)
        },
    })

    try {
        const ingestResponse = await fetch(`${server.baseUrl}/iot/data/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "kalshi-test",
                samples: [
                    { sensor_id: "sensor-esg", metric_type: "temperature", value: 24, timestamp: Date.now() },
                    { sensor_id: "sensor-esg", metric_type: "humidity", value: 48, timestamp: Date.now() + 1 },
                    { sensor_id: "sensor-esg", metric_type: "air_quality", value: 55, timestamp: Date.now() + 2 },
                ],
            }),
        })

        assert.equal(ingestResponse.status, 200)

        const response = await fetch(`${server.baseUrl}/kalshi/esg/trade-plan?ticker=KXESG-1`)
        assert.equal(response.status, 200)

        const body = await response.json()
        assert.equal(body.market.ticker, "KXESG-1")
        assert.equal(body.signal.side, "yes")
        assert.equal(body.signal.action, "buy")
        assert.equal(body.signal.count, 3)
        assert.equal(body.signal.limitPriceCents, 49)
        assert.equal(body.orderPreview.yes_price, 49)
        assert.equal(body.esg.overall, 100)
        assert.equal(calls.length, 2)
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})

test("POST /kalshi/esg/trade-order signs and submits a demo order", async () => {
    const env = snapshotKalshiEnv()
    clearKalshiEnv()
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
    })
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" })
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" })
    const calls = []

    process.env.KALSHI_API_BASE_URL = "https://example.test/trade-api/v2"
    process.env.KALSHI_API_KEY_ID = "demo-order-key"
    process.env.KALSHI_PRIVATE_KEY_PEM = privateKeyPem

    const server = await createTestServer({
        kalshiHttpClient: async (config) => {
            calls.push(config)

            if (config.url.endsWith("/markets/KXESG-2")) {
                return {
                    data: {
                        ticker: "KXESG-2",
                        title: "Will the ESG demo trigger a trade?",
                        status: "open",
                        yes_ask: 46,
                        no_ask: 54,
                        last_price: 45,
                    },
                }
            }

            if (config.url.endsWith("/markets/KXESG-2/orderbook")) {
                return {
                    data: {
                        orderbook_fp: {
                            yes_dollars: [["0.4600", "30.00"]],
                            no_dollars: [["0.5400", "30.00"]],
                        },
                    },
                }
            }

            if (config.url.endsWith("/portfolio/orders")) {
                return {
                    data: {
                        order: {
                            order_id: "order-demo-1",
                            ticker: config.data.ticker,
                            side: config.data.side,
                        },
                    },
                }
            }

            throw new Error(`Unexpected Kalshi URL: ${config.url}`)
        },
    })

    try {
        const ingestResponse = await fetch(`${server.baseUrl}/iot/data/batch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "kalshi-order-test",
                samples: [
                    { sensor_id: "sensor-order", metric_type: "temperature", value: 24, timestamp: Date.now() },
                    { sensor_id: "sensor-order", metric_type: "humidity", value: 45, timestamp: Date.now() + 1 },
                    { sensor_id: "sensor-order", metric_type: "air_quality", value: 40, timestamp: Date.now() + 2 },
                ],
            }),
        })

        assert.equal(ingestResponse.status, 200)

        const response = await fetch(`${server.baseUrl}/kalshi/esg/trade-order`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ticker: "KXESG-2",
            }),
        })

        assert.equal(response.status, 201)

        const body = await response.json()
        assert.equal(body.status, "success")
        assert.equal(body.plan.market.ticker, "KXESG-2")
        assert.equal(body.plan.signal.side, "yes")
        assert.equal(body.order.order.order_id, "order-demo-1")
        assert.equal(calls.length, 3)

        const orderCall = calls[2]
        assert.equal(orderCall.method, "POST")
        assert.equal(orderCall.url, "https://example.test/trade-api/v2/portfolio/orders")
        assert.equal(orderCall.data.ticker, "KXESG-2")
        assert.equal(orderCall.data.side, "yes")
        assert.equal(orderCall.data.action, "buy")
        assert.equal(orderCall.data.yes_price, 46)
        assert.equal(orderCall.headers["KALSHI-ACCESS-KEY"], "demo-order-key")

        const verifier = crypto.createVerify("RSA-SHA256")
        verifier.update(
            `${orderCall.headers["KALSHI-ACCESS-TIMESTAMP"]}POST/trade-api/v2/portfolio/orders`
        )
        verifier.end()

        assert.equal(
            verifier.verify(
                {
                    key: publicKeyPem,
                    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
                },
                Buffer.from(orderCall.headers["KALSHI-ACCESS-SIGNATURE"], "base64")
            ),
            true
        )
    } finally {
        await server.close()
        restoreKalshiEnv(env)
    }
})
