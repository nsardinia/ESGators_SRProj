const COMPANY_LOCATION_REGISTRY = [
  {
    label: "Apple",
    locationLabel: "Cupertino, California",
    latitude: 37.3346,
    longitude: -122.009,
    aliases: ["apple", "iphone"],
  },
  {
    label: "Microsoft",
    locationLabel: "Redmond, Washington",
    latitude: 47.6396,
    longitude: -122.1281,
    aliases: ["microsoft", "xbox", "linkedin"],
  },
  {
    label: "Tesla",
    locationLabel: "Austin, Texas",
    latitude: 30.222,
    longitude: -97.618,
    aliases: ["tesla", "elon"],
  },
  {
    label: "JPMorgan",
    locationLabel: "New York, New York",
    latitude: 40.7554,
    longitude: -73.976,
    aliases: ["jpmorgan", "jamie dimon", "jpm"],
  },
  {
    label: "Citi",
    locationLabel: "New York, New York",
    latitude: 40.7207,
    longitude: -74.0107,
    aliases: ["citi", "citigroup"],
  },
  {
    label: "Netflix",
    locationLabel: "Los Gatos, California",
    latitude: 37.2587,
    longitude: -121.9629,
    aliases: ["netflix"],
  },
  {
    label: "Meta",
    locationLabel: "Menlo Park, California",
    latitude: 37.4848,
    longitude: -122.1484,
    aliases: ["meta", "facebook", "instagram", "threads"],
  },
  {
    label: "OpenAI",
    locationLabel: "San Francisco, California",
    latitude: 37.7749,
    longitude: -122.4194,
    aliases: ["openai", "chatgpt", "sora", "sam altman"],
  },
  {
    label: "Coinbase",
    locationLabel: "San Francisco, California",
    latitude: 37.7906,
    longitude: -122.4013,
    aliases: ["coinbase"],
  },
  {
    label: "Intel",
    locationLabel: "Santa Clara, California",
    latitude: 37.3875,
    longitude: -121.963,
    aliases: ["intel"],
  },
  {
    label: "YouTube",
    locationLabel: "San Bruno, California",
    latitude: 37.6286,
    longitude: -122.4264,
    aliases: ["youtube"],
  },
  {
    label: "SpaceX",
    locationLabel: "Hawthorne, California",
    latitude: 33.9207,
    longitude: -118.328,
    aliases: ["spacex", "starship"],
  },
  {
    label: "TikTok",
    locationLabel: "Culver City, California",
    latitude: 34.0211,
    longitude: -118.3965,
    aliases: ["tiktok", "bytedance"],
  },
]

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function calculateDistanceKm(start, end) {
  const earthRadiusKm = 6371
  const latitudeDelta = toRadians(end.latitude - start.latitude)
  const longitudeDelta = toRadians(end.longitude - start.longitude)
  const startLatitude = toRadians(start.latitude)
  const endLatitude = toRadians(end.latitude)
  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2
  )

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine))
}

function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return "-"
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`
  }

  return `${Math.round(distanceKm)} km`
}

function findCompaniesForMarket(market) {
  const haystack = normalizeText([
    market?.title,
    market?.subtitle,
    market?.question,
    market?.series_ticker,
    market?.ticker,
  ].filter(Boolean).join(" "))

  if (!haystack) {
    return []
  }

  return COMPANY_LOCATION_REGISTRY.filter((company) =>
    company.aliases.some((alias) => haystack.includes(normalizeText(alias)))
  )
}

function buildNearestCompanyMarketHints(markets, nodesWithLocations) {
  if (!Array.isArray(markets) || markets.length === 0 || !Array.isArray(nodesWithLocations) || nodesWithLocations.length === 0) {
    return {}
  }

  return markets.reduce((hintsByTicker, market) => {
    const matchedCompanies = findCompaniesForMarket(market)

    if (!market?.ticker || matchedCompanies.length === 0) {
      return hintsByTicker
    }

    let bestHint = null

    matchedCompanies.forEach((company) => {
      nodesWithLocations.forEach((node) => {
        const distanceKm = calculateDistanceKm(
          { latitude: node.latitude, longitude: node.longitude },
          { latitude: company.latitude, longitude: company.longitude }
        )

        if (!bestHint || distanceKm < bestHint.distanceKm) {
          bestHint = {
            companyLabel: company.label,
            companyLocationLabel: company.locationLabel,
            nodeId: node.deviceId,
            nodeName: node.name || node.deviceId,
            nodeLocationLabel: node.locationLabel,
            distanceKm,
          }
        }
      })
    })

    if (bestHint) {
      hintsByTicker[market.ticker] = {
        ...bestHint,
        distanceLabel: formatDistanceKm(bestHint.distanceKm),
      }
    }

    return hintsByTicker
  }, {})
}

export {
  COMPANY_LOCATION_REGISTRY,
  findCompaniesForMarket,
  buildNearestCompanyMarketHints,
  formatDistanceKm,
}
