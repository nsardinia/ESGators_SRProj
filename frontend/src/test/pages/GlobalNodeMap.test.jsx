/** 
 * Test coverage for the global map page.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import GlobalNodeMap from "@/pages/GlobalNodeMap"

const mockUseOwnedNodes = vi.fn()
const mockUseAuth = vi.fn()

vi.mock("@/components/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/hooks/useOwnedNodes", () => ({
  default: (...args) => mockUseOwnedNodes(...args),
}))

vi.mock("@/components/GlobalNodeMapCanvas", () => ({
  default: ({ nodes, selectedNode }) => (
    <div data-testid="global-map-canvas">
      canvas:{nodes.length}:{selectedNode?.deviceId || "none"}
    </div>
  ),
}))

describe("GlobalNodeMap", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    window.localStorage.clear()
    mockUseAuth.mockReturnValue({
      user: {
        uid: "firebase-user-1",
        email: "owner@example.com",
        displayName: "Owner",
      },
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("renders owned and shared node summary counts", async () => {
    mockUseOwnedNodes.mockReturnValue({
      createdNodes: [
        {
          id: "node-1",
          name: "North Node",
          latitude: 29.65,
          longitude: -82.32,
          isLocationUnknown: false,
        },
      ],
      error: "",
      loadingNodes: false,
      warning: "",
    })

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        devices: [
          {
            deviceId: "shared-1",
            name: "Remote Node",
            latitude: 40.71,
            longitude: -74.0,
            isLocationUnknown: false,
            owner: {
              firebaseUid: "another-user",
              email: "remote@example.com",
            },
          },
        ],
      }),
    }))

    render(<GlobalNodeMap />)

    expect(await screen.findByText("2")).toBeInTheDocument()
    expect(screen.getByText(/your nodes/i)).toBeInTheDocument()
    expect(screen.getByText(/other users/i)).toBeInTheDocument()
    expect(await screen.findByTestId("global-map-canvas")).toHaveTextContent("canvas:2:node-1")
  })

  it("cycles through owned nodes with the toolbar controls", async () => {
    mockUseOwnedNodes.mockReturnValue({
      createdNodes: [
        {
          id: "node-1",
          name: "Alpha Node",
          latitude: 29.65,
          longitude: -82.32,
          isLocationUnknown: false,
        },
        {
          id: "node-2",
          name: "Beta Node",
          latitude: 34.05,
          longitude: -118.24,
          isLocationUnknown: false,
        },
      ],
      error: "",
      loadingNodes: false,
      warning: "",
    })

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        devices: [],
      }),
    }))

    render(<GlobalNodeMap />)

    await waitFor(() => {
      expect(screen.getByTestId("global-map-canvas")).toHaveTextContent("canvas:2:node-1")
    })

    fireEvent.click(screen.getByRole("button", { name: /next/i }))

    expect(screen.getByTestId("global-map-canvas")).toHaveTextContent("canvas:2:node-2")
    expect(window.localStorage.getItem("esgators-active-owned-node-id-v1")).toBe("node-2")
  })
})
