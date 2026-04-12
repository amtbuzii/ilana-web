// Leaflet map view — renders waypoint markers, route polyline, leg arrows, and background routes.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../theme.jsx'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl:       new URL('leaflet/dist/images/marker-icon.png',    import.meta.url).href,
  shadowUrl:     new URL('leaflet/dist/images/marker-shadow.png',  import.meta.url).href,
})

// Tile URL sets — offline uses local backend, online uses public CDNs
const TILE_URLS = {
  offline: {
    map:  'http://localhost:8000/data/tiles/{z}/{x}/{y}.png',
    topo: 'http://localhost:8000/data/topo_tiles/{z}/{x}/{y}.png',
    dem:  'http://localhost:8000/api/dem-tiles/{z}/{x}/{y}.png',
  },
  online: {
    map:  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    dem:  '/api/dem-tiles/{z}/{x}/{y}.png',   // relative — served by deployed backend
  },
}

// Max zoom per mode
const MAX_ZOOM_BY_MODE = { map: 19, topo: 17, dem: 11 }
const MAX_ZOOM_OFFLINE = { map: 11, topo: 14, dem: 11 }

function makeIcon(index, isActive, isHighlighted, t, routeColor) {
  const rc     = routeColor ?? t.accent
  const fill   = isHighlighted ? '#FFD700' : isActive ? rc        : t.border0
  const stroke = isHighlighted ? '#8B6914' : isActive ? t.bg0     : rc
  const text   = isHighlighted ? '#222'    : isActive ? t.bg0     : t.text1
  const sw     = isActive ? '1.5' : '2.5'
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0 C6.3 0 0 6.3 0 14 C0 24.5 14 36 14 36 C14 36 28 24.5 28 14 C28 6.3 21.7 0 14 0Z"
            fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="14" y="18" text-anchor="middle" fill="${text}" font-size="11" font-weight="bold"
            font-family="system-ui">${index + 1}</text>
    </svg>`)
  return L.divIcon({
    html: `<img src="data:image/svg+xml,${svg}" width="28" height="36" />`,
    iconSize: [28, 36], iconAnchor: [14, 36], className: '',
  })
}

function makeArrowIcon(bearingDeg, color) {
  const label = String(Math.round(bearingDeg)).padStart(3, '0')
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="60" height="18" viewBox="0 0 60 18">
      <path d="M9 1 L13 13 L9 10 L5 13 Z"
            fill="${color}" stroke="#000" stroke-width="0.8" stroke-linejoin="round"
            transform="rotate(${bearingDeg}, 9, 9)"/>
      <text x="20" y="13" fill="${color}" font-size="10" font-weight="bold"
            font-family="system-ui" stroke="#000" stroke-width="2" paint-order="stroke">${label}&#176;</text>
    </svg>`)
  return L.divIcon({
    html: `<img src="data:image/svg+xml,${svg}" width="60" height="18" style="pointer-events:none" />`,
    iconSize: [60, 18], iconAnchor: [9, 9], className: '',
  })
}

function makeTerrainXIcon() {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
      <text x="7" y="11" text-anchor="middle" font-size="13" font-weight="900"
            font-family="system-ui" fill="#facc15" stroke="#000" stroke-width="2" paint-order="stroke">✕</text>
    </svg>`)
  return L.divIcon({
    html: `<img src="data:image/svg+xml,${svg}" width="14" height="14" style="pointer-events:none" />`,
    iconSize: [14, 14], iconAnchor: [7, 7], className: '',
  })
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const dL  = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(dL) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dL)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export default function MapView({ waypoints, results, activeWpt, onMapClick, onMarkerClick, highlightedWptIdx, highlightedLeg, sizeKey, bgRoutes, activeRouteColor, opacity = 1, stopAlert = null, alerts = [], addMode = false, tileMode = 'offline' }) {
  const { t } = useTheme()
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const tileLayerRef  = useRef(null)
  const [mapMode,    setMapMode]    = useState('map')   // 'map' | 'topo' | 'dem'
  const [zoomLevel,  setZoomLevel]  = useState(8)
  const markersRef    = useRef([])
  const routeRef      = useRef(null)
  const highlightRef  = useRef(null)
  const arrowsRef     = useRef([])
  const terrainRef    = useRef([])
  const bgLayersRef   = useRef([])
  const stopMarkerRef  = useRef(null)
  const alertMarkersRef = useRef([])
  const waypointsRef  = useRef(waypoints)
  useEffect(() => { waypointsRef.current = waypoints }, [waypoints])

  useEffect(() => {
    if (tileLayerRef.current) tileLayerRef.current.setOpacity(opacity)
  }, [opacity])

  // ── Recenter on highlighted waypoint ────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || highlightedWptIdx === null || highlightedWptIdx === undefined) return
    const w = waypointsRef.current[highlightedWptIdx]
    if (!w) return
    const lat = parseFloat(w.lat), lon = parseFloat(w.lon)
    if (!isNaN(lat) && !isNaN(lon))
      mapRef.current.setView([lat, lon], mapRef.current.getZoom(), { animate: true, duration: 0.3 })
  }, [highlightedWptIdx])   // eslint-disable-line

  // ── Recenter on highlighted leg (center on midpoint) ────────────────────────
  useEffect(() => {
    if (!mapRef.current || highlightedLeg === null || highlightedLeg === undefined) return
    const wpts = waypointsRef.current
    const w1 = wpts[highlightedLeg], w2 = wpts[highlightedLeg + 1]
    if (!w1 || !w2) return
    const lat1 = parseFloat(w1.lat), lon1 = parseFloat(w1.lon)
    const lat2 = parseFloat(w2.lat), lon2 = parseFloat(w2.lon)
    if (!isNaN(lat1) && !isNaN(lat2))
      mapRef.current.setView([(lat1 + lat2) / 2, (lon1 + lon2) / 2],
        mapRef.current.getZoom(), { animate: true, duration: 0.3 })
  }, [highlightedLeg])   // eslint-disable-line

  useEffect(() => {
    if (mapRef.current) return
    const initMz = (tileMode === 'online' ? MAX_ZOOM_BY_MODE : MAX_ZOOM_OFFLINE)['map']
    const map = L.map(containerRef.current, { center: [31.5, 34.8], zoom: 8, maxZoom: initMz })
    tileLayerRef.current = L.tileLayer(TILE_URLS[tileMode]?.map ?? TILE_URLS.offline.map, {
      maxZoom: initMz, maxNativeZoom: initMz, opacity,
      errorTileUrl: '',
    }).addTo(map)
    map.on('click', e => onMapClick(e.latlng.lat, e.latlng.lng))
    map.on('zoomend', () => setZoomLevel(map.getZoom()))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])   // eslint-disable-line

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.off('click')
    mapRef.current.on('click', e => onMapClick(e.latlng.lat, e.latlng.lng))
  }, [onMapClick])

  // ── Swap tile layer when map mode or tileMode changes ────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    if (tileLayerRef.current) tileLayerRef.current.remove()
    const urls = TILE_URLS[tileMode] ?? TILE_URLS.offline
    const url  = mapMode === 'dem' ? urls.dem : mapMode === 'topo' ? urls.topo : urls.map
    const mzMap = tileMode === 'online' ? MAX_ZOOM_BY_MODE : MAX_ZOOM_OFFLINE
    const mz   = mzMap[mapMode]
    mapRef.current.setMaxZoom(mz)
    tileLayerRef.current = L.tileLayer(url, {
      maxZoom: mz, maxNativeZoom: mz, opacity,
      errorTileUrl: '',
    }).addTo(mapRef.current)
  }, [mapMode, tileMode])   // eslint-disable-line

  // ── Resize map when container changes (e.g. panel fold/unfold) ──────────────
  useEffect(() => {
    if (!mapRef.current) return
    setTimeout(() => mapRef.current?.invalidateSize(), 50)
  }, [sizeKey])

  // ── Background routes (non-active, visible) ──────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    bgLayersRef.current.forEach(l => l.remove()); bgLayersRef.current = []
    if (!bgRoutes || bgRoutes.length === 0) return

    bgRoutes.forEach(route => {
      if (!route.waypoints || route.waypoints.length < 2) return
      const lls = route.waypoints.map(w => [parseFloat(w.lat), parseFloat(w.lon)])
      if (lls.some(([la, lo]) => isNaN(la) || isNaN(lo))) return

      // Polyline
      const poly = L.polyline(lls, { color: route.color, weight: 2, opacity: 0.55, dashArray: '6 4' }).addTo(map)
      bgLayersRef.current.push(poly)

      // Direction arrows
      for (let i = 0; i < lls.length - 1; i++) {
        const [lat1, lon1] = lls[i]
        const [lat2, lon2] = lls[i + 1]
        const mid = [(lat1 + lat2) / 2, (lon1 + lon2) / 2]
        const bearing = calcBearing(lat1, lon1, lat2, lon2)
        const arrow = L.marker(mid, { icon: makeArrowIcon(bearing, route.color), interactive: false, zIndexOffset: -200 }).addTo(map)
        bgLayersRef.current.push(arrow)
      }

      // Route name label at first waypoint
      if (lls.length > 0) {
        const label = L.marker(lls[0], {
          icon: L.divIcon({
            html: `<div style="background:${route.color};color:#111;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;font-family:system-ui;pointer-events:none">${route.name}</div>`,
            iconSize: null, iconAnchor: [-4, 16], className: '',
          }),
          interactive: false,
        }).addTo(map)
        bgLayersRef.current.push(label)
      }
    })
  }, [bgRoutes, mapRef.current])   // eslint-disable-line

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    markersRef.current.forEach(m => m.remove()); markersRef.current = []
    arrowsRef.current.forEach(a => a.remove());  arrowsRef.current  = []
    terrainRef.current.forEach(l => l.remove()); terrainRef.current = []
    if (routeRef.current)    { routeRef.current.remove();    routeRef.current    = null }
    if (highlightRef.current){ highlightRef.current.remove(); highlightRef.current = null }
    if (waypoints.length === 0) return

    const latlngs = waypoints.map(w => [parseFloat(w.lat), parseFloat(w.lon)])

    routeRef.current = L.polyline(latlngs, { color: activeRouteColor ?? t.accent, weight: 2, opacity: 0.9, dashArray: '6 4' }).addTo(map)

    // Highlighted leg segment (drawn below markers)
    if (highlightedLeg !== null && highlightedLeg !== undefined && highlightedLeg < latlngs.length - 1) {
      const segPts = [latlngs[highlightedLeg], latlngs[highlightedLeg + 1]]
      highlightRef.current = L.polyline(segPts, { color: '#FFD700', weight: 5, opacity: 0.9 }).addTo(map)
    }

    // Terrain-alert legs: red -X-X-X- overlay
    const terrainAlertLegs = new Set(
      (alerts ?? []).filter(a => a.code === 'TERRAIN_CLEARANCE').map(a => a.wpt_index - 1)
    )
    const xIcon = makeTerrainXIcon()
    for (const i of terrainAlertLegs) {
      if (i < 0 || i >= latlngs.length - 1) continue
      const [lat1, lon1] = latlngs[i]
      const [lat2, lon2] = latlngs[i + 1]
      if (isNaN(lat1) || isNaN(lat2)) continue
      // Yellow dashed line over the leg (caution)
      const poly = L.polyline([[lat1, lon1], [lat2, lon2]], {
        color: '#facc15', weight: 3, opacity: 0.9,
        dashArray: '12 8', interactive: false, zIndexOffset: -50,
      }).addTo(map)
      terrainRef.current.push(poly)
      // ✕ markers at 25%, 50%, 75%
      for (const frac of [0.25, 0.5, 0.75]) {
        const mlat = lat1 + frac * (lat2 - lat1)
        const mlon = lon1 + frac * (lon2 - lon1)
        const xm = L.marker([mlat, mlon], { icon: xIcon, interactive: false, zIndexOffset: 50 }).addTo(map)
        terrainRef.current.push(xm)
      }
    }

    // Direction arrows at midpoint of each leg
    for (let i = 0; i < latlngs.length - 1; i++) {
      const [lat1, lon1] = latlngs[i]
      const [lat2, lon2] = latlngs[i + 1]
      if (isNaN(lat1) || isNaN(lat2)) continue
      const midLat = (lat1 + lat2) / 2
      const midLon = (lon1 + lon2) / 2
      const bearing = calcBearing(lat1, lon1, lat2, lon2)
      const isHighlightedLeg = highlightedLeg === i
      const arrowColor = isHighlightedLeg ? '#FFD700' : (activeRouteColor ?? t.accent)
      const arrow = L.marker([midLat, midLon], {
        icon: makeArrowIcon(bearing, arrowColor),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(map)
      arrowsRef.current.push(arrow)
    }

    waypoints.forEach((w, i) => {
      const wptResult    = results?.waypoints?.[i]
      const isHighlighted = highlightedWptIdx === i
      const ogeColor      = wptResult ? (wptResult.oge_feasible ? t.ok : t.warn) : t.text1
      const popupHtml = wptResult
        ? `<div style="font-size:11px;line-height:1.7;font-family:system-ui">
             <b>${w.name || `WP${i+1}`}</b><br>
             Fuel: <b>${wptResult.fuel_remaining_lbs} lbs</b><br>
             GW: ${wptResult.gross_weight_lbs} lbs<br>
             PA: ${wptResult.pa_available_pct}% &nbsp; OGE: ${wptResult.oge_torque_required_pct}%<br>
             <span style="color:${ogeColor};font-weight:700">${wptResult.oge_feasible ? '◆ OGE GO' : '✗ OGE NO-GO'}</span>
           </div>`
        : `<b>${w.name || `WP${i+1}`}</b>`

      const marker = L.marker([parseFloat(w.lat), parseFloat(w.lon)], {
        icon: makeIcon(i, activeWpt === w.index, isHighlighted, t, activeRouteColor),
      }).bindPopup(popupHtml)
        .bindTooltip(w.name || `WP${i+1}`, { permanent: true, direction: 'right', offset: [6, -18], className: 'wpt-label' })
        .addTo(map)
      marker.on('click', () => onMarkerClick?.(i))
      markersRef.current.push(marker)
    })

    if (latlngs.length >= 2) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] })
  }, [waypoints, results, activeWpt, highlightedWptIdx, highlightedLeg, t, activeRouteColor, alerts])

  // ── Stop-alert marker (WARNING=red, CAUTION=yellow) ─────────────────────────
  useEffect(() => {
    if (stopMarkerRef.current) { stopMarkerRef.current.remove(); stopMarkerRef.current = null }
    if (!mapRef.current || !stopAlert) return
    const color  = stopAlert.level === 'WARNING' ? '#ef4444' : '#facc15'
    const border = stopAlert.level === 'WARNING' ? '#7f1d1d' : '#78350f'
    const icon   = stopAlert.level === 'WARNING' ? '⚠' : '◆'
    const svg = encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="16" fill="${color}" stroke="${border}" stroke-width="2.5"/>
        <text x="18" y="23" text-anchor="middle" font-size="16" font-family="system-ui">${icon}</text>
      </svg>`)
    const stopIcon = L.divIcon({
      html: `<img src="data:image/svg+xml,${svg}" width="36" height="36" />`,
      iconSize: [36, 36], iconAnchor: [18, 18], className: '',
    })
    const popup = `<div style="font-size:11px;line-height:1.6;font-family:system-ui;max-width:220px">
      <b style="color:${color}">${stopAlert.level}</b><br>${stopAlert.message}
    </div>`
    stopMarkerRef.current = L.marker([stopAlert.lat, stopAlert.lon], { icon: stopIcon, zIndexOffset: 1000 })
      .bindPopup(popup)
      .addTo(mapRef.current)
      .openPopup()
    mapRef.current.panTo([stopAlert.lat, stopAlert.lon], { animate: true, duration: 0.4 })
  }, [stopAlert])   // eslint-disable-line

  // ── WCA alert markers (one per waypoint, highest-severity) ──────────────────
  useEffect(() => {
    alertMarkersRef.current.forEach(m => m.remove())
    alertMarkersRef.current = []
    if (!mapRef.current || !alerts.length) return

    // Keep only highest-severity alert per waypoint index
    const ORDER = { WARNING: 0, CAUTION: 1, ADVISORY: 2 }
    const LEVEL_CFG = {
      WARNING:  { color: '#ef4444', border: '#7f1d1d', icon: '⚠' },
      CAUTION:  { color: '#facc15', border: '#78350f', icon: '◆' },
      ADVISORY: { color: '#60a5fa', border: '#1e3a5f', icon: 'ℹ' },
    }
    const best = {}
    for (const a of alerts) {
      if (a.code === 'TERRAIN_CLEARANCE') continue   // shown as leg overlay, not a point marker
      const prev = best[a.wpt_index]
      if (!prev || ORDER[a.level] < ORDER[prev.level]) best[a.wpt_index] = a
    }

    const resultWpts = results?.waypoints ?? []
    for (const a of Object.values(best)) {
      const wpt = resultWpts[a.wpt_index]
      if (!wpt) continue
      const { color, border, icon } = LEVEL_CFG[a.level]
      const svg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="12" fill="${color}" stroke="${border}" stroke-width="2"/>
          <text x="14" y="19" text-anchor="middle" font-size="13" font-family="system-ui">${icon}</text>
        </svg>`)
      const markerIcon = L.divIcon({
        html: `<img src="data:image/svg+xml,${svg}" width="28" height="28" />`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: '',
      })
      const popup = `<div style="font-size:11px;line-height:1.6;font-family:system-ui;max-width:220px">
        <b style="color:${color}">${a.level}</b> — ${a.wpt_name}<br>${a.message}
      </div>`
      const marker = L.marker([wpt.lat, wpt.lon], { icon: markerIcon, zIndexOffset: 500 })
        .bindPopup(popup)
        .addTo(mapRef.current)
      alertMarkersRef.current.push(marker)
    }
  }, [alerts, results])   // eslint-disable-line

  const btnBase = {
    fontFamily: t.font, fontSize: 9, fontWeight: 700, letterSpacing: 1,
    border: `1px solid ${t.border0}`, borderRadius: 3, cursor: 'pointer',
    padding: '3px 7px', userSelect: 'none',
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: addMode ? 'crosshair' : activeWpt !== null ? 'crosshair' : 'grab' }} />

      {/* Add-from-map mode banner */}
      {addMode && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1200, pointerEvents: 'none',
          background: '#0ea5e9', border: '2px solid #0284c7',
          borderRadius: 6, padding: '5px 16px',
          fontSize: 10, fontWeight: 700, color: '#000',
          letterSpacing: 1.5, fontFamily: 'monospace',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          🗺 CLICK MAP TO ADD WAYPOINTS
        </div>
      )}

      {/* Zoom level badge — top left, below the +/- control (~74px down) */}
      <div style={{
        position: 'absolute', top: 74, left: 10, zIndex: 1000,
        background: t.bg1 + 'cc', border: `1px solid ${t.border0}`,
        borderRadius: 3, padding: '2px 6px',
        fontSize: 9, fontWeight: 700, fontFamily: t.font,
        color: t.text2, letterSpacing: 1, pointerEvents: 'none',
      }}>
        Z {zoomLevel} / {(tileMode === 'online' ? MAX_ZOOM_BY_MODE : MAX_ZOOM_OFFLINE)[mapMode]}
      </div>

      {/* Map / TOPO / ELEV toggle — bottom left, above attribution */}
      <div style={{ position: 'absolute', bottom: 24, left: 10, zIndex: 2000, display: 'flex', gap: 2, pointerEvents: 'all' }}>
        {[['map', 'MAP'], ['topo', 'TOPO'], ['dem', 'ELEV']].map(([mode, label]) => (
          <button key={mode} onClick={() => setMapMode(mode)}
            style={{ ...btnBase, background: mapMode === mode ? t.accent : t.bg1, color: mapMode === mode ? t.bg0 : t.text2,
              boxShadow: mapMode === mode ? `0 0 0 1px ${t.accent}` : 'none' }}
          >{label}</button>
        ))}
      </div>
    </div>
  )
}
