import { render, screen } from "@testing-library/react"
import { vi } from "vitest"
import axios from "axios"
import App from "./App"

vi.mock("axios")
vi.mock("./auth/AuthContext", () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: { uid: "123", displayName: "Test User", email: "test@example.com" },
    loading: false,
  }),
}))
vi.mock("./lib/firebase", () => ({
  auth: {},
  isFirebaseConfigured: true,
  firebaseConfigError: "",
  missingFirebaseEnvKeys: [],
}))
vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({})),
}))
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    callback({ uid: "123", displayName: "Test User", email: "test@example.com" })
    return vi.fn()
  }),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  signOut: vi.fn(),
}))

test("renders dashboard heading", async () => {
  axios.get.mockResolvedValueOnce({ data: {} })
  window.history.pushState({}, "", "/app/dashboard")
  render(<App />)
  const heading = await screen.findByText(/ESGators Dashboard/i)
  expect(heading).toBeInTheDocument()
})
