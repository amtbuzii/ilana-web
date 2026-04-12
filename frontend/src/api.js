// API client — thin wrappers around the backend REST endpoints.
// In production set VITE_API_BASE to the deployed backend URL, e.g.:
//   VITE_API_BASE=https://einat-backend.onrender.com
const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api'

// Format Pydantic 422 validation error arrays into readable messages.
function fmtDetail(detail) {
  if (!Array.isArray(detail)) return String(detail)
  return detail.map(e => {
    // loc = ['body', 'waypoints', 0, 'alt_ft'] → 'WP1 alt_ft'
    const parts = e.loc.filter(l => l !== 'body')
    let where = ''
    const wptIdx = parts.findIndex(p => p === 'waypoints')
    if (wptIdx !== -1 && typeof parts[wptIdx + 1] === 'number') {
      where = `WP${parts[wptIdx + 1] + 1} ${parts[wptIdx + 2] ?? ''}: `.trimEnd() + ' '
    } else {
      where = parts.join(' → ') + ': '
    }
    return where + e.msg
  }).join('\n')
}

export async function calculateFlightPlan(payload) {
  const res = await fetch(`${BASE}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(fmtDetail(err.detail) || 'Calculation failed')
  }
  return res.json()
}

export async function utmToLatLon(zone, easting, northing) {
  const res = await fetch(`${BASE}/utm-to-latlon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, easting, northing }),
  })
  if (!res.ok) throw new Error('UTM conversion failed')
  return res.json()
}

export async function fetchElevation(lat, lon) {
  const res = await fetch(`${BASE}/elevation?lat=${lat}&lon=${lon}`)
  if (!res.ok) return { elevation_ft: 0, default_alt_ft: 1000 }
  return res.json()
}

export async function cspFuelFromOge(variant, alt_ft, oat_c, empty_weight_lbs, target_oge_pct, n_bidons) {
  const res = await fetch(`${BASE}/csp/fuel-from-oge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant, alt_ft, oat_c, empty_weight_lbs, target_oge_pct, n_bidons }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'OGE lookup failed') }
  return res.json()
}

export async function cspFuelFromIge(variant, alt_ft, oat_c, empty_weight_lbs, target_ige_pct, n_bidons) {
  const res = await fetch(`${BASE}/csp/fuel-from-ige`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant, alt_ft, oat_c, empty_weight_lbs, target_ige_pct, n_bidons }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'IGE lookup failed') }
  return res.json()
}

export async function latLonToUtm(lat, lon) {
  const res = await fetch(`${BASE}/latlon-to-utm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon }),
  })
  if (!res.ok) throw new Error('Conversion failed')
  return res.json()
}
