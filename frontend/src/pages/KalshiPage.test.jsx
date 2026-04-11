import { render, screen, waitFor } from "@testing-library/react"
import KalshiPage from "./KalshiPage"

describe("KalshiPage", () => {
  it("loads the ESG trade plan, market data, and recent orders", async () => {
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

      if (normalizedUrl.includes("/kalshi/portfolio/orders?limit=5")) {
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

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })
    } finally {
      global.fetch = originalFetch
    }
  })
})
