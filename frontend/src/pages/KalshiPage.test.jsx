import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import KalshiPage from "./KalshiPage"

vi.mock("../components/AuthContext", () => ({
  useAuth: () => ({
    user: {
      uid: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
    },
  }),
}))

vi.mock("../hooks/useOwnedNodes", () => ({
  default: () => ({
    createdNodes: [
      {
        id: "node-1",
        name: "North Node",
      },
    ],
    error: "",
    loadingNodes: false,
    warning: "",
  }),
}))

describe("KalshiPage", () => {
  it("loads the ESG trade plan, market data, and recent orders", async () => {
    const originalFetch = global.fetch
    const fetchCalls = []

    global.fetch = vi.fn(async (url, options = {}) => {
      const normalizedUrl = String(url)
      const method = String(options?.method || "GET").toUpperCase()
      fetchCalls.push({ url: normalizedUrl, method })

      if (normalizedUrl.endsWith("/kalshi/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            config: {
              environment: "demo",
              baseUrl: "https://demo-api.kalshi.co/trade-api/v2",
              authConfigured: true,
              hasApiKeyId: true,
              hasPrivateKey: true,
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/esg/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            latest: {
              overall: 88.4,
              metricScores: {
                air_quality: 91,
                humidity: 86,
                temperature: 84,
              },
            },
            bufferedSamples: 5,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets?")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            markets: [
              {
                ticker: "KXTEST-1",
                title: "Will the demo market render?",
                status: "open",
                close_time: "2026-04-11T12:00:00.000Z",
              },
            ],
            cursor: "",
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/markets/KXTEST-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            ticker: "KXTEST-1",
            title: "Will the demo market render?",
            status: "open",
            yes_bid: 47,
            yes_ask: 49,
            last_price: 48,
            close_time: "2026-04-11T12:00:00.000Z",
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets/KXTEST-1/orderbook")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orderbook_fp: {
              yes_dollars: [["0.4900", "25.00"]],
              no_dollars: [["0.5100", "18.00"]],
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/portfolio/balance")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            balance: 12500,
            available_balance: 11800,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/portfolio/orders?limit=25")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orders: [
              {
                order_id: "order-1",
                ticker: "KXTEST-1",
                side: "yes",
                action: "buy",
                count: 2,
                status: "executed",
              },
            ],
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/esg/trade-plan?ticker=KXTEST-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            signal: {
              side: "yes",
              action: "buy",
              count: 3,
              confidence: "high",
              limitPriceCents: 49,
              rationale: "Overall ESG score 88.40 supports a YES bias.",
            },
            market: {
              ticker: "KXTEST-1",
              title: "Will the demo market render?",
            },
            orderPreview: {
              client_order_id: "preview-1",
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/esg/trade-order") && method === "POST") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            status: "success",
            plan: {
              market: {
                ticker: "KXTEST-1",
              },
              orderPreview: {
                client_order_id: "preview-1",
              },
            },
            order: {
              order: {
                order_id: "order-2",
              },
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/iot/data/batch") && method === "POST") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            status: "success",
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    try {
      render(<KalshiPage />)

      expect(await screen.findByText(/esg-to-trade demo/i)).toBeInTheDocument()
      expect(await screen.findByText(/signal source/i)).toBeInTheDocument()
      expect(await screen.findByText("$125.00")).toBeInTheDocument()
      expect(await screen.findByText("$118.00")).toBeInTheDocument()
      expect(await screen.findByText(/overall score/i)).toBeInTheDocument()
      expect(await screen.findByText(/recommended side/i)).toBeInTheDocument()
      expect(await screen.findByText(/overall esg score 88\.40 supports a yes bias/i)).toBeInTheDocument()
      expect((await screen.findAllByText("KXTEST-1")).length).toBeGreaterThan(0)
      expect(await screen.findByText("0.4900")).toBeInTheDocument()
      expect(await screen.findByText("25.00")).toBeInTheDocument()
      expect(await screen.findByText(/demo trade history/i)).toBeInTheDocument()
      expect(await screen.findByText(/executed/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/category/i)).toHaveValue("Companies")
      expect(fetchCalls.some((call) => call.url.includes("/kalshi/markets?category=Companies&status=open&limit=12"))).toBe(true)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })
    } finally {
      global.fetch = originalFetch
    }
  })

  it("resets market filters back to the default companies category beside the load action", async () => {
    const originalFetch = global.fetch
    const fetchCalls = []

    global.fetch = vi.fn(async (url, options = {}) => {
      const normalizedUrl = String(url)
      const method = String(options?.method || "GET").toUpperCase()
      fetchCalls.push({ url: normalizedUrl, method })

      if (normalizedUrl.endsWith("/kalshi/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            config: {
              environment: "demo",
              baseUrl: "https://demo-api.kalshi.co/trade-api/v2",
              authConfigured: true,
              hasApiKeyId: true,
              hasPrivateKey: true,
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/esg/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            latest: {
              overall: 88.4,
              metricScores: {
                air_quality: 91,
              },
            },
            bufferedSamples: 5,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets?")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            markets: [
              {
                ticker: "KXTEST-1",
                title: "Will the demo market render?",
                status: "open",
                close_time: "2026-04-11T12:00:00.000Z",
              },
            ],
            cursor: "",
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/markets/KXTEST-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            ticker: "KXTEST-1",
            title: "Will the demo market render?",
            status: "open",
            yes_bid: 47,
            yes_ask: 49,
            last_price: 48,
            close_time: "2026-04-11T12:00:00.000Z",
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets/KXTEST-1/orderbook")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orderbook_fp: {
              yes_dollars: [["0.4900", "25.00"]],
              no_dollars: [["0.5100", "18.00"]],
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/portfolio/balance")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            balance: 12500,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/portfolio/orders?limit=25")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orders: [],
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/esg/trade-plan?ticker=KXTEST-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            signal: {
              side: "yes",
              action: "buy",
              count: 3,
              confidence: "high",
              limitPriceCents: 49,
              rationale: "Overall ESG score 88.40 supports a YES bias.",
            },
            market: {
              ticker: "KXTEST-1",
              title: "Will the demo market render?",
            },
            orderPreview: {
              client_order_id: "preview-1",
            },
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    try {
      render(<KalshiPage />)

      const categorySelect = await screen.findByLabelText(/category/i)
      const seriesInput = screen.getByLabelText(/series ticker/i)

      await userEvent.selectOptions(categorySelect, "Crypto")
      await userEvent.type(seriesInput, "KXBTC")
      await userEvent.click(screen.getByRole("button", { name: /reset all/i }))

      await waitFor(() => {
        expect(categorySelect).toHaveValue("Companies")
        expect(seriesInput).toHaveValue("")
      })

      expect(fetchCalls.some((call) => call.url.includes("/kalshi/markets?category=Companies&status=open&limit=12"))).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
  })

  it("annotates known company markets with the closest node-to-HQ hint", async () => {
    const originalFetch = global.fetch

    global.fetch = vi.fn(async (url, options = {}) => {
      const normalizedUrl = String(url)
      const method = String(options?.method || "GET").toUpperCase()

      if (normalizedUrl.endsWith("/kalshi/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            config: {
              environment: "demo",
              baseUrl: "https://demo-api.kalshi.co/trade-api/v2",
              authConfigured: true,
              hasApiKeyId: true,
              hasPrivateKey: true,
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/esg/status")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            latest: {
              overall: 88.4,
              metricScores: {
                air_quality: 91,
              },
            },
            bufferedSamples: 5,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets?")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            markets: [
              {
                ticker: "APPLEFOLD-1",
                title: "Apple reveals foldable iPhone",
                status: "open",
                close_time: "2026-04-11T12:00:00.000Z",
              },
            ],
            cursor: "",
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/markets/APPLEFOLD-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            ticker: "APPLEFOLD-1",
            title: "Apple reveals foldable iPhone",
            status: "open",
            yes_bid: 47,
            yes_ask: 49,
            last_price: 48,
            close_time: "2026-04-11T12:00:00.000Z",
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/markets/APPLEFOLD-1/orderbook")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orderbook_fp: {
              yes_dollars: [["0.4900", "25.00"]],
              no_dollars: [["0.5100", "18.00"]],
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/kalshi/portfolio/balance")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            balance: 12500,
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/portfolio/orders?limit=25")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            orders: [],
          }),
        }
      }

      if (normalizedUrl.includes("/kalshi/esg/trade-plan?ticker=APPLEFOLD-1")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            signal: {
              side: "yes",
              action: "buy",
              count: 3,
              confidence: "high",
              limitPriceCents: 49,
              rationale: "Overall ESG score 88.40 supports a YES bias.",
            },
            market: {
              ticker: "APPLEFOLD-1",
              title: "Apple reveals foldable iPhone",
            },
            orderPreview: {
              client_order_id: "preview-1",
            },
          }),
        }
      }

      if (normalizedUrl.endsWith("/iot/data/batch") && method === "POST") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            status: "success",
          }),
        }
      }

      throw new Error(`Unhandled fetch URL: ${normalizedUrl}`)
    })

    try {
      render(<KalshiPage />)

      expect(await screen.findByText(/closest known hq: apple in cupertino, california/i)).toBeInTheDocument()
      expect(await screen.findByText(/kalshi company markets do not include coordinates/i)).toBeInTheDocument()
      expect(await screen.findByText(/using global node map coordinates from north node/i)).toBeInTheDocument()
    } finally {
      global.fetch = originalFetch
    }
  })
})
