import { useEffect, useRef } from "react"
import MapView, { Marker, NavigationControl } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { GAINESVILLE_FALLBACK } from "../lib/nodeLocations"

const MAPTILER_KEY = "1JJeayhUVMAg3qND1WEC"
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`

function NodeLocationPicker({ latitude, longitude, onSelectLocation }) {
  const mapRef = useRef(null)
  const hasCenteredInitialView = useRef(false)

  useEffect(() => {
    if (!mapRef.current || latitude === null || longitude === null || hasCenteredInitialView.current) {
      return
    }

    mapRef.current.flyTo({
      center: [longitude, latitude],
      zoom: 12.6,
      duration: 900,
      essential: true,
    })

    hasCenteredInitialView.current = true
  }, [latitude, longitude])

  return (
    <div className="node-location-picker">
      <MapView
        ref={mapRef}
        initialViewState={{
          latitude: latitude ?? GAINESVILLE_FALLBACK.latitude,
          longitude: longitude ?? GAINESVILLE_FALLBACK.longitude,
          zoom: latitude !== null && longitude !== null ? 12.6 : 10.2,
        }}
        mapStyle={MAP_STYLE}
        minZoom={2}
        maxZoom={19}
        dragRotate={false}
        reuseMaps
        style={{ width: "100%", height: "100%" }}
        onClick={(event) => {
          onSelectLocation({
            latitude: event.lngLat.lat,
            longitude: event.lngLat.lng,
          })
        }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {latitude !== null && longitude !== null && (
          <Marker latitude={latitude} longitude={longitude} anchor="bottom">
            <div className="node-location-picker-marker" aria-hidden="true" />
          </Marker>
        )}
      </MapView>
    </div>
  )
}

export default NodeLocationPicker
