/**
 * Test coverage for dashboard
 * 
 * Last Edit: Nicholas Sardinia, 4/20/2026
 */
import { fireEvent, render, screen } from "@testing-library/react"
import DashboardPage from "@/pages/DashboardPage"

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => ({
    user: {
      uid: "owner-123",
      email: "owner@example.com",
    },
  }),
}))

describe("DashboardPage", () => {
  const originalFetch = global.fetch
  const originalDashboardUrl = import.meta.env.VITE_GRAFANA_DASHBOARD_URL

  afterEach(() => {
    global.fetch = originalFetch

    if (originalDashboardUrl === undefined) {
      delete import.meta.env.VITE_GRAFANA_DASHBOARD_URL
    } else {
      import.meta.env.VITE_GRAFANA_DASHBOARD_URL = originalDashboardUrl
    }
  })

  it("shows the Grafana launch flow instead of an embedded frame", () => {
    import.meta.env.VITE_GRAFANA_DASHBOARD_URL = "https://grafana.example.test/dashboard?from=now-5m"

    render(<DashboardPage />)

    expect(screen.queryByTitle(/grafana dashboard/i)).not.toBeInTheDocument()
    expect(screen.getByText(/inline embed is currently unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /open grafana dashboard/i })).toBeInTheDocument()
  })

  it("appends the signed-in owner context before opening Grafana", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    import.meta.env.VITE_GRAFANA_DASHBOARD_URL = "https://grafana.example.test/dashboard"

    try {
      render(<DashboardPage />)

      fireEvent.click(screen.getByRole("button", { name: /open grafana dashboard/i }))

      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(openSpy).toHaveBeenCalledWith(
        "https://grafana.example.test/dashboard?var-owner_uid=owner-123&var-owner_email=owner%40example.com",
        "_blank",
        "noopener,noreferrer"
      )
    } finally {
      openSpy.mockRestore()
    }
  })

  it("shows an export failure message when CSV download fails", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      text: async () => "Export unavailable",
    }))

    render(<DashboardPage />)

    fireEvent.click(screen.getByRole("button", { name: /export day csv/i }))

    expect(await screen.findByText(/export unavailable/i)).toBeInTheDocument()
  })
})
