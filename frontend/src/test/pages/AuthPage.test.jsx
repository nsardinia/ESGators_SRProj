/** 
 * Test coverage for the auth page.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import AuthPage from "@/pages/AuthPage"

const mockNavigate = vi.fn()
const mockSignInWithEmailAndPassword = vi.fn()
const mockCreateUserWithEmailAndPassword = vi.fn()
const mockUpdateProfile = vi.fn()
const mockUseAuth = vi.fn()

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: (...args) => mockSignInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: (...args) => mockCreateUserWithEmailAndPassword(...args),
  updateProfile: (...args) => mockUpdateProfile(...args),
}))

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")

  return {
    ...actual,
    useLocation: () => ({
      state: {
        from: {
          pathname: "/app/dashboard",
        },
      },
    }),
    useNavigate: () => mockNavigate,
  }
})

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/lib/firebase-auth", () => ({
  auth: { name: "test-auth" },
}))

vi.mock("@/lib/firebase-core", () => ({
  isFirebaseConfigured: true,
  notifyFirebaseConfigError: vi.fn(),
}))

describe("AuthPage", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    mockNavigate.mockReset()
    mockSignInWithEmailAndPassword.mockReset()
    mockCreateUserWithEmailAndPassword.mockReset()
    mockUpdateProfile.mockReset()
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    })
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("submits the login form and navigates to the dashboard", async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue({
      user: { uid: "firebase-user-1" },
    })

    render(<AuthPage />)

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "owner@example.com" },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "hunter22" },
    })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        { name: "test-auth" },
        "owner@example.com",
        "hunter22"
      )
    })

    expect(mockNavigate).toHaveBeenCalledWith("/app/dashboard", { replace: true })
  })

  it("switches to signup mode, syncs the new user, and navigates onward", async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue({
      user: {
        uid: "firebase-user-2",
        displayName: "",
      },
    })

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "success" }),
    }))

    render(<AuthPage />)

    fireEvent.click(screen.getByRole("button", { name: /need an account\? sign up/i }))
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Jane Developer" },
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "jane@example.com" },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "hunter22" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create account/i }))

    await waitFor(() => {
      expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
        { name: "test-auth" },
        "jane@example.com",
        "hunter22"
      )
    })

    expect(mockUpdateProfile).toHaveBeenCalledWith(
      { uid: "firebase-user-2", displayName: "" },
      { displayName: "Jane Developer" }
    )
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/users$/),
      expect.objectContaining({
        method: "POST",
      })
    )
    expect(mockNavigate).toHaveBeenCalledWith("/app/dashboard", { replace: true })
  })
})
