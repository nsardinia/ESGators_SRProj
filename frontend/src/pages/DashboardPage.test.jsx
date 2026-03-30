import { fireEvent, render, screen } from "@testing-library/react"
import DashboardPage from "./DashboardPage"

describe("DashboardPage", () => {
  it("opens Grafana only when the user clicks the button", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    render(<DashboardPage />)

    expect(openSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /open grafana dashboard/i }))

    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith(
      import.meta.env.VITE_GRAFANA_DASHBOARD_URL,
      "_blank",
      "noopener,noreferrer"
    )
  })
})
