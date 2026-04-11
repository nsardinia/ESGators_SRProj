import { useEffect, useMemo, useState } from "react"
import { BACKEND_API_BASE_URL } from "../lib/api"

const defaultFilters = {
  status: "open",
  series_ticker: "",
  limit: "12",
}

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "settled", label: "Settled" },
  { value: "", label: "All" },
]

const demoScenarioOptions = [
  {
    key: "strong",
    label: "Strong ESG",
    description: "Healthy sensor readings push the ESG score high and bias the demo toward YES.",
  },
  {
    key: "mixed",
    label: "Mixed ESG",
    description: "A few warning signals create a smaller hedge-style order suggestion.",
  },
  {
    key: "weak",
    label: "Weak ESG",
    description: "Critical readings drag the ESG score down and bias the demo toward NO.",
  },
]

const cardClassName =
  "rounded-[8px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent),var(--bg-elevated)] p-[18px] shadow-[0_18px_44px_rgba(0,0,0,0.24)]"
const sectionLabelClassName =
  "mb-[10px] text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]"
const fieldClassName =
  "min-h-10 rounded-[8px] border border-[var(--border)] bg-[#141b28] px-3 text-[0.94rem] text-[var(--text)] outline-none transition-colors placeholder:text-[#647084] focus:border-[#3ecf8e]"
const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border border-[rgba(62,207,142,0.45)] bg-[rgba(62,207,142,0.18)] px-4 py-2 text-[0.94rem] text-[#d3f5e4] transition-colors hover:border-[rgba(62,207,142,0.62)] hover:bg-[rgba(62,207,142,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
const secondaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[#1a2232] px-4 py-2 text-[0.94rem] text-[var(--text)] transition-colors hover:border-[#334055] hover:bg-[#20293b] disabled:cursor-not-allowed disabled:opacity-60"
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function formatDate(value) {
  if (!value) {
    return "TBD"
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }

  return parsed.toLocaleString()
}

function formatValue(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback
  }

  return String(value)
}

function formatMetricLabel(metricType) {
  return String(metricType || "")
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function formatCurrencyFromCents(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return formatValue(value)
  }

  return usdFormatter.format(numericValue / 100)
}

function formatUnixTimestamp(value) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return formatValue(value)
  }

  const timestampMs = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000
  return new Date(timestampMs).toLocaleString()
}

function formatPortfolioLabel(key) {
  if (key === "updated_ts") {
    return "Updated"
  }

  return formatMetricLabel(key)
}

function formatPortfolioValue(key, value) {
  if (/_ts$/i.test(String(key || ""))) {
    return formatUnixTimestamp(value)
  }

  if (/(^balance$|_balance$|_value$|^portfolio_value$|_cost$|_fees$)/i.test(String(key || ""))) {
    return formatCurrencyFromCents(value)
  }

  return formatValue(value)
}

function formatMarketPrice(value) {
  if (value === null || value === undefined || value === "") {
    return "-"
  }

  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return String(value)
  }

  if (numericValue > 0 && numericValue < 1) {
    return `${Math.round(numericValue * 100)}c`
  }

  if (numericValue >= 1 && numericValue <= 99) {
    return `${Math.round(numericValue)}c`
  }

  return String(value)
}

function readMarketPrice(marketDetail, centsField, dollarsField) {
  return marketDetail?.[centsField] ?? marketDetail?.[dollarsField] ?? null
}

function extractMarkets(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.markets)) {
    return payload.markets
  }

  return []
}

function extractMarketDetail(payload) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  return payload.market || payload
}

function extractOrderbookLevels(payload) {
  const book = payload?.orderbook_fp || payload?.orderbook || payload || {}

  return {
    yes: Array.isArray(book.yes_dollars) ? book.yes_dollars : Array.isArray(book.yes) ? book.yes : [],
    no: Array.isArray(book.no_dollars) ? book.no_dollars : Array.isArray(book.no) ? book.no : [],
  }
}

function extractOrders(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (Array.isArray(payload?.orders)) {
    return payload.orders
  }

  return []
}

function buildScenarioPayload(preset) {
  const now = Date.now()
  const sensorId = `kalshi-demo-${preset}`
  const scenarioValues = {
    strong: {
      temperature: 23.8,
      humidity: 47,
      air_quality: 48,
      no2: 22,
      noise_levels: 42,
    },
    mixed: {
      temperature: 31.2,
      humidity: 66,
      air_quality: 92,
      no2: 81,
      noise_levels: 72,
    },
    weak: {
      temperature: 39.5,
      humidity: 88,
      air_quality: 182,
      no2: 168,
      noise_levels: 96,
    },
  }
  const selectedValues = scenarioValues[preset] || scenarioValues.mixed

  return {
    source: `kalshi-demo-${preset}`,
    samples: Object.entries(selectedValues).map(([metric_type, value], index) => ({
      sensor_id: sensorId,
      metric_type,
      value,
      timestamp: now + index,
    })),
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    const detail = typeof body === "string"
      ? body
      : body?.detail || body?.error || JSON.stringify(body)
    throw new Error(detail || `Request failed with status ${response.status}`)
  }

  return body
}

function KalshiPage() {
  const [filters, setFilters] = useState(defaultFilters)
  const [statusPayload, setStatusPayload] = useState(null)
  const [markets, setMarkets] = useState([])
  const [marketsCursor, setMarketsCursor] = useState("")
  const [selectedTicker, setSelectedTicker] = useState("")
  const [marketDetail, setMarketDetail] = useState(null)
  const [orderbook, setOrderbook] = useState({ yes: [], no: [] })
  const [portfolioBalance, setPortfolioBalance] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [esgStatus, setEsgStatus] = useState(null)
  const [tradePlan, setTradePlan] = useState(null)
  const [tradeResult, setTradeResult] = useState(null)
  const [statusError, setStatusError] = useState("")
  const [marketsError, setMarketsError] = useState("")
  const [detailError, setDetailError] = useState("")
  const [portfolioError, setPortfolioError] = useState("")
  const [ordersError, setOrdersError] = useState("")
  const [esgError, setEsgError] = useState("")
  const [tradePlanError, setTradePlanError] = useState("")
  const [tradeSubmitError, setTradeSubmitError] = useState("")
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingMarkets, setLoadingMarkets] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingPortfolio, setLoadingPortfolio] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingEsg, setLoadingEsg] = useState(true)
  const [loadingTradePlan, setLoadingTradePlan] = useState(false)
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [seedingScenarioKey, setSeedingScenarioKey] = useState("")

  async function loadStatus() {
    setLoadingStatus(true)
    setStatusError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/status`)
      setStatusPayload(payload)
    } catch (error) {
      setStatusError(error.message || "Failed to load Kalshi status")
    } finally {
      setLoadingStatus(false)
    }
  }

  async function loadMarkets(nextFilters = filters) {
    const params = new URLSearchParams()

    Object.entries(nextFilters).forEach(([key, value]) => {
      const trimmedValue = String(value || "").trim()

      if (trimmedValue) {
        params.set(key, trimmedValue)
      }
    })

    setLoadingMarkets(true)
    setMarketsError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/markets?${params.toString()}`)
      const nextMarkets = extractMarkets(payload)
      const nextTicker = nextMarkets.find((market) => market?.ticker === selectedTicker)?.ticker
        || nextMarkets[0]?.ticker
        || ""

      setMarkets(nextMarkets)
      setMarketsCursor(formatValue(payload?.cursor, ""))
      setSelectedTicker(nextTicker)

      if (nextTicker) {
        await loadMarketSnapshot(nextTicker)
      } else {
        setMarketDetail(null)
        setOrderbook({ yes: [], no: [] })
      }
    } catch (error) {
      setMarkets([])
      setSelectedTicker("")
      setMarketDetail(null)
      setOrderbook({ yes: [], no: [] })
      setMarketsError(error.message || "Failed to load Kalshi markets")
    } finally {
      setLoadingMarkets(false)
    }
  }

  async function loadMarketSnapshot(ticker) {
    if (!ticker) {
      return
    }

    setLoadingDetail(true)
    setDetailError("")

    try {
      const [detailPayload, orderbookPayload] = await Promise.all([
        fetchJson(`${BACKEND_API_BASE_URL}/kalshi/markets/${encodeURIComponent(ticker)}`),
        fetchJson(`${BACKEND_API_BASE_URL}/kalshi/markets/${encodeURIComponent(ticker)}/orderbook?depth=10`),
      ])

      setMarketDetail(extractMarketDetail(detailPayload))
      setOrderbook(extractOrderbookLevels(orderbookPayload))
    } catch (error) {
      setMarketDetail(null)
      setOrderbook({ yes: [], no: [] })
      setDetailError(error.message || "Failed to load market detail")
    } finally {
      setLoadingDetail(false)
    }
  }

  async function loadPortfolioBalance() {
    setLoadingPortfolio(true)
    setPortfolioError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/portfolio/balance`)
      setPortfolioBalance(payload)
    } catch (error) {
      setPortfolioBalance(null)
      setPortfolioError(error.message || "Failed to load portfolio balance")
    } finally {
      setLoadingPortfolio(false)
    }
  }

  async function loadOrders() {
    setLoadingOrders(true)
    setOrdersError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/portfolio/orders?limit=5`)
      setRecentOrders(extractOrders(payload))
    } catch (error) {
      setRecentOrders([])
      setOrdersError(error.message || "Failed to load recent orders")
    } finally {
      setLoadingOrders(false)
    }
  }

  async function loadEsgStatus() {
    setLoadingEsg(true)
    setEsgError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/esg/status`)
      setEsgStatus(payload)
    } catch (error) {
      setEsgStatus(null)
      setEsgError(error.message || "Failed to load ESG status")
    } finally {
      setLoadingEsg(false)
    }
  }

  async function loadTradePlan(ticker = selectedTicker) {
    if (!ticker) {
      setTradePlan(null)
      return
    }

    setLoadingTradePlan(true)
    setTradePlanError("")

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/esg/trade-plan?ticker=${encodeURIComponent(ticker)}`)
      setTradePlan(payload)
    } catch (error) {
      setTradePlan(null)
      setTradePlanError(error.message || "Failed to load ESG trade plan")
    } finally {
      setLoadingTradePlan(false)
    }
  }

  async function handleSeedScenario(preset) {
    setSeedingScenarioKey(preset)
    setTradeResult(null)
    setTradeSubmitError("")

    try {
      await fetchJson(`${BACKEND_API_BASE_URL}/iot/data/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildScenarioPayload(preset)),
      })

      await loadEsgStatus()
      if (selectedTicker) {
        await loadTradePlan(selectedTicker)
      }
    } catch (error) {
      setEsgError(error.message || "Failed to seed ESG demo scenario")
    } finally {
      setSeedingScenarioKey("")
    }
  }

  async function handlePlaceTrade() {
    if (!selectedTicker) {
      return
    }

    setTradeSubmitting(true)
    setTradeSubmitError("")
    setTradeResult(null)

    try {
      const payload = await fetchJson(`${BACKEND_API_BASE_URL}/kalshi/esg/trade-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker: selectedTicker,
        }),
      })

      setTradeResult(payload)
      await Promise.all([
        loadPortfolioBalance(),
        loadOrders(),
        loadTradePlan(selectedTicker),
      ])
    } catch (error) {
      setTradeSubmitError(error.message || "Failed to place demo trade")
    } finally {
      setTradeSubmitting(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    void loadEsgStatus()
    void loadMarkets(defaultFilters)
    void loadPortfolioBalance()
    void loadOrders()
  }, [])

  const latestOverall = Number(esgStatus?.latest?.overall)

  useEffect(() => {
    if (!selectedTicker) {
      setTradePlan(null)
      return
    }

    if (!Number.isFinite(latestOverall)) {
      setTradePlan(null)
      setTradePlanError("Generate or sync ESG data to build a demo trading plan.")
      return
    }

    void loadTradePlan(selectedTicker)
  }, [selectedTicker, latestOverall])

  const balanceEntries = useMemo(() => {
    if (!portfolioBalance || typeof portfolioBalance !== "object") {
      return []
    }

    return Object.entries(portfolioBalance).slice(0, 6).map(([key, value]) => ({
      key,
      label: formatPortfolioLabel(key),
      value: formatPortfolioValue(key, value),
    }))
  }, [portfolioBalance])

  const metricScores = useMemo(() => {
    const entries = Object.entries(esgStatus?.latest?.metricScores || {})

    return entries.sort((left, right) => Number(right[1]) - Number(left[1]))
  }, [esgStatus])

  const selectedMarketTitle = marketDetail?.title || marketDetail?.subtitle || marketDetail?.question || selectedTicker
  const kalshiConfig = statusPayload?.config
  const authenticatedTradingReady = Boolean(kalshiConfig?.authConfigured)
  const recentOrderItems = recentOrders.slice(0, 5)

  return (
    <section className="flex min-h-0 max-w-[1220px] flex-1 flex-col gap-5">
      <div>
        <p className="mb-[10px] pt-2 text-base font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
          Kalshi
        </p>
        <h1 className="mb-2 text-[clamp(1.5rem,2.4vw,2.2rem)] font-semibold text-[var(--text)]">
          ESG-to-trade demo
        </h1>
        <p className="max-w-[820px] text-base leading-7 text-[var(--muted)]">
          Turn the live ESG report into a demo trading signal, preview the order against a Kalshi market, and submit a
          signed trade in the demo environment.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <article className={cardClassName}>
          <p className={sectionLabelClassName}>Connection</p>
          {loadingStatus ? (
            <p className="text-[0.95rem] text-[var(--muted)]">Checking backend Kalshi status...</p>
          ) : statusError ? (
            <p className="text-[0.95rem] text-[#f9b4b4]">{statusError}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Environment</p>
                <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">
                  {formatValue(kalshiConfig?.environment, "unknown")}
                </p>
                <p className="mt-1 text-[0.9rem] text-[var(--muted)]">{formatValue(kalshiConfig?.baseUrl)}</p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Credentials</p>
                <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">
                  {authenticatedTradingReady ? "Demo trading ready" : "Public market data ready"}
                </p>
                <p className="mt-1 text-[0.9rem] text-[var(--muted)]">
                  API key: {kalshiConfig?.hasApiKeyId ? "connected" : "missing"} / Private key: {kalshiConfig?.hasPrivateKey ? "connected" : "missing"}
                </p>
              </div>
            </div>
          )}
        </article>

        <article className={cardClassName}>
          <p className={sectionLabelClassName}>Portfolio</p>
          {loadingPortfolio ? (
            <p className="text-[0.95rem] text-[var(--muted)]">Checking authenticated routes...</p>
          ) : portfolioBalance ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {balanceEntries.map((entry) => (
                <div key={entry.key} className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                  <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">{entry.label}</p>
                  <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">{entry.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[0.95rem] text-[var(--muted)]">
                {authenticatedTradingReady
                  ? "Portfolio routes are configured, but the balance request still needs a fresh check."
                  : "Add both the Kalshi API key and private key to unlock authenticated demo trading."}
              </p>
              {portfolioError ? (
                <p className="text-[0.92rem] text-[#f9b4b4]">{portfolioError}</p>
              ) : null}
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void loadPortfolioBalance()}
              >
                Retry portfolio check
              </button>
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <article className={cardClassName}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className={sectionLabelClassName}>ESG Report</p>
              <h2 className="text-[1.12rem] font-semibold text-[var(--text)]">Signal source</h2>
            </div>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => void loadEsgStatus()}
              disabled={loadingEsg}
            >
              {loadingEsg ? "Refreshing..." : "Refresh ESG"}
            </button>
          </div>

          {esgError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{esgError}</p> : null}

          {loadingEsg ? (
            <p className="text-[0.95rem] text-[var(--muted)]">Loading current ESG status...</p>
          ) : esgStatus?.latest?.overall !== null && esgStatus?.latest?.overall !== undefined ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                  <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Overall score</p>
                  <p className="mt-2 text-[1.3rem] font-semibold text-[var(--text)]">
                    {formatValue(esgStatus?.latest?.overall)}
                  </p>
                </div>
                <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                  <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Buffered samples</p>
                  <p className="mt-2 text-[1.3rem] font-semibold text-[var(--text)]">
                    {formatValue(esgStatus?.bufferedSamples, "0")}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]">Metric scores</p>
                {metricScores.length === 0 ? (
                  <p className="text-[0.92rem] text-[var(--muted)]">No metric scores available yet.</p>
                ) : (
                  metricScores.map(([metricType, score]) => (
                    <div key={metricType} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                      <span className="text-[0.94rem] text-[var(--text)]">{formatMetricLabel(metricType)}</span>
                      <span className="text-[0.94rem] font-semibold text-[var(--text)]">{formatValue(score)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="text-[0.95rem] text-[var(--muted)]">
              No ESG score is buffered yet. Seed a demo scenario or sync fresh sensor data first.
            </p>
          )}

          <div className="mt-5 space-y-3">
            <p className="text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]">Demo scenarios</p>
            {demoScenarioOptions.map((scenario) => (
              <div key={scenario.key} className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.98rem] font-semibold text-[var(--text)]">{scenario.label}</p>
                    <p className="mt-1 text-[0.9rem] leading-6 text-[var(--muted)]">{scenario.description}</p>
                  </div>
                  <button
                    type="button"
                    className={primaryButtonClassName}
                    onClick={() => void handleSeedScenario(scenario.key)}
                    disabled={Boolean(seedingScenarioKey)}
                  >
                    {seedingScenarioKey === scenario.key ? "Applying..." : "Use scenario"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={cardClassName}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className={sectionLabelClassName}>Trade Plan</p>
              <h2 className="text-[1.12rem] font-semibold text-[var(--text)]">ESG-driven demo order</h2>
            </div>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => void loadTradePlan(selectedTicker)}
              disabled={loadingTradePlan || !selectedTicker}
            >
              {loadingTradePlan ? "Refreshing..." : "Refresh plan"}
            </button>
          </div>

          {tradePlanError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{tradePlanError}</p> : null}
          {tradeSubmitError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{tradeSubmitError}</p> : null}

          {loadingTradePlan ? (
            <p className="text-[0.95rem] text-[var(--muted)]">Building the trade plan from the latest ESG report...</p>
          ) : tradePlan ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                  <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Recommended side</p>
                  <p className="mt-2 text-[1.1rem] font-semibold text-[var(--text)]">
                    {String(tradePlan?.signal?.side || "").toUpperCase()} {formatValue(tradePlan?.signal?.action)}
                  </p>
                </div>
                <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                  <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Contracts / price</p>
                  <p className="mt-2 text-[1.1rem] font-semibold text-[var(--text)]">
                    {formatValue(tradePlan?.signal?.count)} @ {formatValue(tradePlan?.signal?.limitPriceCents)}c
                  </p>
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-4">
                <p className="text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]">Rationale</p>
                <p className="mt-2 text-[0.96rem] leading-7 text-[var(--text)]">{tradePlan?.signal?.rationale}</p>
                <p className="mt-3 text-[0.9rem] text-[var(--muted)]">
                  Market: {formatValue(tradePlan?.market?.title)} ({formatValue(tradePlan?.market?.ticker)}) / Confidence: {formatValue(tradePlan?.signal?.confidence)}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={primaryButtonClassName}
                  onClick={() => void handlePlaceTrade()}
                  disabled={tradeSubmitting || !authenticatedTradingReady}
                >
                  {tradeSubmitting ? "Placing demo order..." : "Place demo order"}
                </button>
                {!authenticatedTradingReady ? (
                  <p className="self-center text-[0.9rem] text-[var(--muted)]">
                    Signed trading stays disabled until the Kalshi private key is connected.
                  </p>
                ) : null}
              </div>

              {tradeResult?.order ? (
                <div className="rounded-[8px] border border-[rgba(62,207,142,0.28)] bg-[rgba(62,207,142,0.08)] px-4 py-4">
                  <p className="text-[0.82rem] uppercase tracking-[0.05em] text-[#b9ebd2]">Latest trade result</p>
                  <p className="mt-2 text-[0.96rem] text-[var(--text)]">
                    Order submitted for {formatValue(tradeResult?.plan?.market?.ticker)} with client order id {formatValue(tradeResult?.plan?.orderPreview?.client_order_id)}.
                  </p>
                  <p className="mt-2 text-[0.9rem] text-[var(--muted)]">
                    Returned order id: {formatValue(tradeResult?.order?.order?.order_id || tradeResult?.order?.order_id)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[0.95rem] text-[var(--muted)]">
              Select a market and make sure an ESG score exists to generate the demo order plan.
            </p>
          )}
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <article className={cardClassName}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[150px] flex-1">
              <label className="mb-2 block text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]" htmlFor="kalshi-series-ticker">
                Series ticker
              </label>
              <input
                id="kalshi-series-ticker"
                className={fieldClassName}
                value={filters.series_ticker}
                onChange={(event) => setFilters((current) => ({ ...current, series_ticker: event.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="mb-2 block text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]" htmlFor="kalshi-status-filter">
                Market status
              </label>
              <select
                id="kalshi-status-filter"
                className={fieldClassName}
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                {statusOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[120px]">
              <label className="mb-2 block text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]" htmlFor="kalshi-limit">
                Limit
              </label>
              <input
                id="kalshi-limit"
                className={fieldClassName}
                value={filters.limit}
                onChange={(event) => setFilters((current) => ({ ...current, limit: event.target.value.replace(/[^\d]/g, "") }))}
                inputMode="numeric"
              />
            </div>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => void loadMarkets(filters)}
              disabled={loadingMarkets}
            >
              {loadingMarkets ? "Loading..." : "Load markets"}
            </button>
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className={sectionLabelClassName}>Markets</p>
              <p className="text-[0.94rem] text-[var(--muted)]">
                {markets.length} markets loaded{marketsCursor ? `, cursor ${marketsCursor}` : ""}.
              </p>
            </div>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => {
                void loadStatus()
                void loadPortfolioBalance()
                void loadOrders()
                void loadMarkets(filters)
              }}
              disabled={loadingStatus || loadingPortfolio || loadingOrders || loadingMarkets}
            >
              Refresh all
            </button>
          </div>

          {marketsError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{marketsError}</p> : null}

          <div className="overflow-hidden rounded-[8px] border border-[var(--border)]">
            <div className="grid grid-cols-[minmax(0,1.35fr)_120px_160px] gap-3 border-b border-[var(--border)] bg-[#121927] px-4 py-3 text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)] max-[760px]:hidden">
              <span>Market</span>
              <span>Status</span>
              <span>Close</span>
            </div>
            <div className="max-h-[540px] overflow-y-auto">
              {loadingMarkets ? (
                <p className="px-4 py-5 text-[0.95rem] text-[var(--muted)]">Loading market list...</p>
              ) : markets.length === 0 ? (
                <p className="px-4 py-5 text-[0.95rem] text-[var(--muted)]">No markets matched that filter.</p>
              ) : (
                markets.map((market) => {
                  const isActive = market?.ticker === selectedTicker

                  return (
                    <button
                      key={market?.ticker}
                      type="button"
                      className={`grid w-full grid-cols-[minmax(0,1.35fr)_120px_160px] gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-b-0 max-[760px]:grid-cols-1 ${isActive ? "bg-[rgba(62,207,142,0.12)]" : "bg-transparent hover:bg-[#131b29]"}`}
                      onClick={() => {
                        const nextTicker = market?.ticker || ""
                        setSelectedTicker(nextTicker)
                        void loadMarketSnapshot(nextTicker)
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[0.97rem] font-semibold text-[var(--text)]">
                          {market?.title || market?.subtitle || market?.question || market?.ticker}
                        </p>
                        <p className="mt-1 truncate text-[0.85rem] text-[var(--muted)]">{market?.ticker}</p>
                      </div>
                      <div className="text-[0.92rem] text-[var(--muted)]">{formatValue(market?.status)}</div>
                      <div className="text-[0.92rem] text-[var(--muted)]">{formatDate(market?.close_time || market?.expiration_time)}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </article>

        <div className="grid gap-4">
          <article className={cardClassName}>
            <div className="mb-4">
              <p className={sectionLabelClassName}>Selected Market</p>
              <h2 className="text-[1.12rem] font-semibold text-[var(--text)]">
                {selectedMarketTitle || "Pick a market"}
              </h2>
              {selectedTicker ? (
                <p className="mt-1 text-[0.92rem] text-[var(--muted)]">{selectedTicker}</p>
              ) : null}
            </div>

            {detailError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{detailError}</p> : null}

            {loadingDetail ? (
              <p className="text-[0.95rem] text-[var(--muted)]">Loading market detail...</p>
            ) : marketDetail ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                    <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Status</p>
                    <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">{formatValue(marketDetail?.status)}</p>
                  </div>
                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                    <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Close time</p>
                    <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">
                      {formatDate(marketDetail?.close_time || marketDetail?.expiration_time)}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                    <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Yes bid / ask</p>
                    <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">
                      {formatMarketPrice(readMarketPrice(marketDetail, "yes_bid", "yes_bid_dollars"))} / {formatMarketPrice(readMarketPrice(marketDetail, "yes_ask", "yes_ask_dollars"))}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                    <p className="text-[0.78rem] uppercase tracking-[0.05em] text-[var(--muted)]">Last price</p>
                    <p className="mt-2 text-[1rem] font-semibold text-[var(--text)]">
                      {formatMarketPrice(readMarketPrice(marketDetail, "last_price", "last_price_dollars"))}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] p-4">
                    <p className="mb-3 text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]">Yes orderbook</p>
                    {orderbook.yes.length === 0 ? (
                      <p className="text-[0.92rem] text-[var(--muted)]">No yes-side levels returned.</p>
                    ) : (
                      <div className="space-y-2">
                        {orderbook.yes.slice(0, 6).map((level, index) => (
                          <div key={`yes-${index}`} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[#0f1520] px-3 py-2">
                            <span className="text-[0.9rem] text-[var(--text)]">{formatValue(level?.[0])}</span>
                            <span className="text-[0.84rem] text-[var(--muted)]">{formatValue(level?.[1])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[8px] border border-[var(--border)] bg-[#121927] p-4">
                    <p className="mb-3 text-[0.82rem] uppercase tracking-[0.05em] text-[var(--muted)]">No orderbook</p>
                    {orderbook.no.length === 0 ? (
                      <p className="text-[0.92rem] text-[var(--muted)]">No no-side levels returned.</p>
                    ) : (
                      <div className="space-y-2">
                        {orderbook.no.slice(0, 6).map((level, index) => (
                          <div key={`no-${index}`} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[#0f1520] px-3 py-2">
                            <span className="text-[0.9rem] text-[var(--text)]">{formatValue(level?.[0])}</span>
                            <span className="text-[0.84rem] text-[var(--muted)]">{formatValue(level?.[1])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[0.95rem] text-[var(--muted)]">Choose a market to inspect the current book.</p>
            )}
          </article>

          <article className={cardClassName}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className={sectionLabelClassName}>Recent Orders</p>
                <h2 className="text-[1.12rem] font-semibold text-[var(--text)]">Demo trade history</h2>
              </div>
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => void loadOrders()}
                disabled={loadingOrders}
              >
                {loadingOrders ? "Refreshing..." : "Refresh orders"}
              </button>
            </div>

            {ordersError ? <p className="mb-3 text-[0.92rem] text-[#f9b4b4]">{ordersError}</p> : null}

            {loadingOrders ? (
              <p className="text-[0.95rem] text-[var(--muted)]">Loading recent demo orders...</p>
            ) : recentOrderItems.length === 0 ? (
              <p className="text-[0.95rem] text-[var(--muted)]">No recent orders returned yet.</p>
            ) : (
              <div className="space-y-2">
                {recentOrderItems.map((order, index) => (
                  <div key={order?.order_id || order?.client_order_id || index} className="rounded-[8px] border border-[var(--border)] bg-[#121927] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[0.96rem] font-semibold text-[var(--text)]">
                        {formatValue(order?.ticker)}
                      </p>
                      <p className="text-[0.88rem] text-[var(--muted)]">
                        {formatValue(order?.status)}
                      </p>
                    </div>
                    <p className="mt-2 text-[0.9rem] text-[var(--muted)]">
                      {String(order?.side || "").toUpperCase()} {formatValue(order?.action)} / Count {formatValue(order?.remaining_count ?? order?.count)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  )
}

export default KalshiPage
