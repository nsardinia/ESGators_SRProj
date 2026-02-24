import { render, screen } from "@testing-library/react"
import { vi } from "vitest"
import axios from "axios"
import App from "./App"

vi.mock("axios")

test("renders dashboard heading", async () => {
  axios.get.mockResolvedValueOnce({ data: {} })
  window.history.pushState({}, "", "/app/dashboard")
  render(<App />)
  const heading = await screen.findByText(/ESGators Dashboard/i)
  expect(heading).toBeInTheDocument()
})
