import { fireEvent, render, screen } from "@testing-library/react"
import DashboardPage from "./DashboardPage"

vi.mock("../components/AuthContext", () => ({
  useAuth: () => ({
    user: {
      uid: "owner-123",
      email: "owner@example.com",
    },
  }),
}))

describe("DashboardPage", () => {
  it("shows the Grafana link flow instead of an embedded frame", () => {
    const dashboardUrl = "https://grafana.example.test/dashboard?from=now-5m"
    const previousDashboardUrl = import.meta.env.VITE_GRAFANA_DASHBOARD_URL

    import.meta.env.VITE_GRAFANA_DASHBOARD_URL = dashboardUrl

    try {
      render(<DashboardPage />)

      expect(screen.queryByTitle(/grafana dashboard/i)).not.toBeInTheDocument()
      expect(screen.getByText(/inline embed is currently unavailable/i)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /open grafana dashboard/i })).toBeInTheDocument()
    } finally {
      import.meta.env.VITE_GRAFANA_DASHBOARD_URL = previousDashboardUrl
    }
  })

  it("opens Grafana only when requested", () => {
    const dashboardUrl = "https://grafana.example.test/dashboard"
    const previousDashboardUrl = import.meta.env.VITE_GRAFANA_DASHBOARD_URL
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    import.meta.env.VITE_GRAFANA_DASHBOARD_URL = dashboardUrl

    try {
      render(<DashboardPage />)

      expect(openSpy).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole("button", { name: /open grafana dashboard/i }))

      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(openSpy).toHaveBeenCalledWith(
        "https://grafana.example.test/dashboard?var-owner_uid=owner-123&var-owner_email=owner%40example.com",
        "_blank",
        "noopener,noreferrer"
      )
    } finally {
      openSpy.mockRestore()
      import.meta.env.VITE_GRAFANA_DASHBOARD_URL = previousDashboardUrl
    }
  })
})
