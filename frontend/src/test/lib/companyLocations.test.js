/**
 * Test coverage for company location logic.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
import {
  buildNearestCompanyMarketHints,
  findCompaniesForMarket,
  formatDistanceKm,
} from "@/lib/companyLocations"

describe("companyLocations", () => {
  it("matches company aliases from market text", () => {
    const matches = findCompaniesForMarket({
      ticker: "APPLEFOLD-1",
      title: "Apple reveals foldable iPhone",
    })

    expect(matches.map((company) => company.label)).toContain("Apple")
  })

  it("picks the nearest node when building company hints", () => {
    const hints = buildNearestCompanyMarketHints(
      [
        {
          ticker: "OPENAI-1",
          title: "OpenAI launches a new ChatGPT feature",
        },
      ],
      [
        {
          deviceId: "node-west",
          name: "West Node",
          locationLabel: "Downtown San Francisco",
          latitude: 37.775,
          longitude: -122.4195,
        },
        {
          deviceId: "node-east",
          name: "East Node",
          locationLabel: "New York",
          latitude: 40.7128,
          longitude: -74.006,
        },
      ]
    )

    expect(hints["OPENAI-1"]).toMatchObject({
      companyLabel: "OpenAI",
      companyLocationLabel: "San Francisco, California",
      nodeId: "node-west",
      nodeName: "West Node",
      nodeLocationLabel: "Downtown San Francisco",
    })
    expect(hints["OPENAI-1"].distanceKm).toBeLessThan(1)
  })

  it("formats nearby and distant distances differently", () => {
    expect(formatDistanceKm(3.456)).toBe("3.5 km")
    expect(formatDistanceKm(27.2)).toBe("27 km")
  })
})
