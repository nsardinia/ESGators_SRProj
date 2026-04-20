/**
 * Test coverage for node location logic.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import {
  GAINESVILLE_FALLBACK,
  buildNodesWithLocations,
  formatCoordinateLabel,
  getNodeLocation,
} from "@/lib/nodeLocations"

describe("nodeLocations", () => {
  it("uses a stored node location when one exists", () => {
    const location = getNodeLocation(
      { id: "node-1" },
      {
        "node-1": {
          latitude: 40.7128,
          longitude: -74.006,
          label: "40.7128, -74.0060",
          isUnknown: false,
        },
      }
    )

    expect(location).toMatchObject({
      latitude: 40.7128,
      longitude: -74.006,
      isUnknown: false,
    })
  })

  it("falls back to Gainesville when a node has no saved coordinates", () => {
    const nodes = buildNodesWithLocations([{ id: "node-2", name: "Fallback node" }], {}).nodes

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      deviceId: "node-2",
      latitude: GAINESVILLE_FALLBACK.latitude,
      longitude: GAINESVILLE_FALLBACK.longitude,
      locationLabel: GAINESVILLE_FALLBACK.label,
      isLocationUnknown: true,
    })
  })

  it("formats map coordinate labels with four decimal places", () => {
    expect(formatCoordinateLabel(29.6516123, -82.3248123)).toBe("29.6516, -82.3248")
  })
})
