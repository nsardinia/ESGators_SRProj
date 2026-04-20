/**
 * Test coverage for the protected route component.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import ProtectedRoute from "@/components/ProtectedRoute"

const mockUseAuth = vi.fn()
const mockNotifyFirebaseConfigError = vi.fn()

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/lib/firebase-core", () => ({
  isFirebaseConfigured: true,
  notifyFirebaseConfigError: () => mockNotifyFirebaseConfigError(),
}))

describe("ProtectedRoute", () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    mockNotifyFirebaseConfigError.mockReset()
  })

  it("redirects unauthenticated users to the auth page", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    })

    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route
            path="/app/dashboard"
            element={(
              <ProtectedRoute>
                <div>Secret dashboard</div>
              </ProtectedRoute>
            )}
          />
          <Route path="/auth" element={<div>Auth page</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText("Auth page")).toBeInTheDocument()
    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument()
    expect(mockNotifyFirebaseConfigError).toHaveBeenCalled()
  })

  it("renders children for authenticated users", () => {
    mockUseAuth.mockReturnValue({
      user: {
        uid: "firebase-user-1",
      },
      loading: false,
    })

    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route
            path="/app/dashboard"
            element={(
              <ProtectedRoute>
                <div>Secret dashboard</div>
              </ProtectedRoute>
            )}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText("Secret dashboard")).toBeInTheDocument()
  })
})
