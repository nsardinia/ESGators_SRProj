require("dotenv").config()

const argv = process.argv.slice(2)

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

  if (cli["base-url"]) {
    return String(cli["base-url"])
  }

  if (target === "fly") {
    return process.env.DUMMY_BASE_URL_FLY || process.env.DUMMY_BASE_URL || "http://localhost:5000"
  }

  if (target === "local") {
    return process.env.DUMMY_BASE_URL_LOCAL || process.env.DUMMY_BASE_URL || "http://localhost:5000"
  }

  return process.env.DUMMY_BASE_URL || process.env.DUMMY_BASE_URL_LOCAL || "http://localhost:5000"
}

const BASE_URL = resolveBaseUrl()
const ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/iot/dummy`

const REQUEST_COUNT = toNumber(
  cli.count,
  toNumber(process.env.DUMMY_REQUEST_COUNT, toNumber(process.env.DUMMY_TOTAL_MINUTES, 60))
)

const INTERVAL_SECONDS = toNumber(
  cli.interval,
  toNumber(
    process.env.DUMMY_INTERVAL_SECONDS,
    process.env.DUMMY_INTERVAL_MS ? Number(process.env.DUMMY_INTERVAL_MS) / 1000 : 60
  )
)

const INTERVAL_MS = Math.round(INTERVAL_SECONDS * 1000)
const PAYLOAD_COUNT = toNumber(cli["payload-count"], toNumber(process.env.DUMMY_COUNT, 5))
const MIN = toNumber(cli.min, toNumber(process.env.DUMMY_MIN, 10))
const MAX = toNumber(cli.max, toNumber(process.env.DUMMY_MAX, 100))
const SEED = cli.seed

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pushOnce(iteration) {
  const startedAt = new Date().toISOString()
  const payload = {
    count: PAYLOAD_COUNT,
    min: MIN,
    max: MAX,
  }

  if (SEED !== undefined) {
    payload.seed = String(SEED)
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

  const generated = body?.generated ?? "unknown"
  console.log(`[${startedAt}] ${iteration}/${REQUEST_COUNT} pushed, generated=${generated}`)
}

async function run() {
  if (!Number.isInteger(REQUEST_COUNT) || REQUEST_COUNT < 1) {
    throw new Error("--count must be an integer >= 1")
  }

  if (!Number.isFinite(INTERVAL_SECONDS) || INTERVAL_SECONDS < 0) {
    throw new Error("--interval must be a number >= 0")
  }

  if (!Number.isFinite(MIN) || !Number.isFinite(MAX) || MIN >= MAX) {
    throw new Error("--min and --max must be valid numbers and min < max")
  }

  console.log(`Start pushing dummy data to ${ENDPOINT}`)
  console.log(
    `Schedule: ${REQUEST_COUNT} times, every ${INTERVAL_SECONDS}s | payload: count=${PAYLOAD_COUNT}, min=${MIN}, max=${MAX}`
  )

  for (let iteration = 1; iteration <= REQUEST_COUNT; iteration += 1) {
    try {
      await pushOnce(iteration)
    } catch (error) {
      console.error(error.message)
    }

    if (iteration < REQUEST_COUNT) {
      await delay(INTERVAL_MS)
    }
  }

  console.log("Finished dummy data schedule.")
}

run().catch((error) => {
  console.error("Fatal error:", error.message)
  process.exit(1)
})
