/**
 * Test coverage for the app shell component.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import AppShell from "@/components/AppShell"

const mockUseAuth = vi.fn()
const mockSignOut = vi.fn()

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("firebase/auth", () => ({
  signOut: (...args) => mockSignOut(...args),
}))

vi.mock("@/components/RegisteredDeviceSync", () => ({
  default: () => <div data-testid="registered-device-sync">sync</div>,
}))

vi.mock("@/lib/firebase-auth", () => ({
  auth: { name: "test-auth" },
}))

describe("AppShell", () => {
  beforeEach(() => {
    mockSignOut.mockReset()
    mockUseAuth.mockReturnValue({
      user: {
        uid: "firebase-user-1",
        email: "owner@example.com",
        displayName: "Owner",
      },
    })
  })

  function renderShell() {
    return render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="dashboard" element={<div>Dashboard content</div>} />
          </Route>
          <Route path="/profile/account" element={<div>Profile page</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it("renders the core shell navigation and outlet content", () => {
    renderShell()

    expect(screen.getByTestId("registered-device-sync")).toBeInTheDocument()
    expect(screen.getByText("Dashboard content")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open profile settings/i })).toBeInTheDocument()
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Configuration")).toBeInTheDocument()
    expect(screen.getByText("Kalshi")).toBeInTheDocument()
  })

  it("signs the user out from the shell action", () => {
    renderShell()

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }))

    expect(mockSignOut).toHaveBeenCalledWith({ name: "test-auth" })
  })
})
