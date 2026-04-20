/**
 * Test coverage for the configuration page.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { render, screen } from "@testing-library/react"
import ConfigurationPage from "@/pages/ConfigurationPage"

const mockUseOwnedNodes = vi.fn()
const mockUseAuth = vi.fn()

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/hooks/useOwnedNodes", () => ({
  default: (...args) => mockUseOwnedNodes(...args),
}))

vi.mock("@/components/NodeNetwork", () => ({
  default: ({ nodes, ownerFirebaseUid }) => (
    <div data-testid="node-network">
      network:{nodes.length}:{ownerFirebaseUid || "none"}
    </div>
  ),
}))

describe("ConfigurationPage", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        uid: "firebase-user-1",
        email: "owner@example.com",
      },
    })
  })

  it("shows a loading state before nodes are available", () => {
    mockUseOwnedNodes.mockReturnValue({
      createdNodes: [],
      error: "",
      loadingNodes: true,
      warning: "",
      owner: null,
    })

    render(<ConfigurationPage />)

    expect(screen.getByText(/configuration/i)).toBeInTheDocument()
    expect(screen.getByText(/loading your nodes/i)).toBeInTheDocument()
    expect(screen.getByTestId("node-network")).toHaveTextContent("network:0:none")
  })

  it("shows the warning banner and passes nodes to the network view", () => {
    mockUseOwnedNodes.mockReturnValue({
      createdNodes: [
        { id: "node-1", name: "North greenhouse sensor" },
        { id: "node-2", name: "Field sensor" },
      ],
      error: "",
      loadingNodes: false,
      warning: "Live telemetry is unavailable right now.",
      owner: {
        firebase_uid: "owner-123",
      },
    })

    render(<ConfigurationPage />)

    expect(screen.getByText(/live telemetry is unavailable right now/i)).toBeInTheDocument()
    expect(screen.getByTestId("node-network")).toHaveTextContent("network:2:owner-123")
  })
})
