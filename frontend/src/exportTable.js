// Export helpers — generate a print-ready HTML flight table and an Excel workbook from route results.
import * as XLSX from 'xlsx'

const VARIANT_LABELS = {
  LB:    'AH-64D — SARAF',
  peten: 'AH-64A — PETEN',
}

// ── UTM ↔ Lat/Lon (WGS84, standalone — no backend dependency) ─────────────

export function utmToLatLon(zoneNum, zoneLetter, easting, northing) {
  const a   = 6378137.0
  const f   = 1 / 298.257223563
  const b   = a * (1 - f)
  const e2  = (a * a - b * b) / (a * a)
  const e2p = e2 / (1 - e2)
  const k0  = 0.9996
  const e1  = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))

  const northern = zoneLetter.toUpperCase() >= 'N'
  const x    = easting - 500000
  // Southern hemisphere northing is offset by 10,000,000 m
  const y    = northern ? northing : northing - 10000000
  const lon0 = ((zoneNum - 1) * 6 - 180 + 3) * Math.PI / 180

  const M   = y / k0
  const mu  = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))
  // Footprint latitude via series expansion
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)

  const sinP = Math.sin(phi1), cosP = Math.cos(phi1), tanP = Math.tan(phi1)
  const N1 = a / Math.sqrt(1 - e2 * sinP * sinP)
  const T1 = tanP * tanP
  const C1 = e2p * cosP * cosP
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinP * sinP, 1.5)
  const D  = x / (N1 * k0)

  const lat = (phi1 - (N1 * tanP / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2p) * Math.pow(D, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2p - 3 * C1 * C1) * Math.pow(D, 6) / 720
  )) * 180 / Math.PI

  const lon = (lon0 + (
    D
    - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2p + 24 * T1 * T1) * Math.pow(D, 5) / 120
  ) / cosP) * 180 / Math.PI

  return { lat, lon }
}

function latLonToUTM(lat, lon) {
  const a   = 6378137.0
  const f   = 1 / 298.257223563
  const b   = a * (1 - f)
  const e2  = (a * a - b * b) / (a * a)
  const e2p = e2 / (1 - e2)
  const k0  = 0.9996

  const latR  = lat * Math.PI / 180
  const zone  = Math.floor((lon + 180) / 6) + 1
  const lonR0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180

  const sinLat = Math.sin(latR)
  const cosLat = Math.cos(latR)
  const tanLat = Math.tan(latR)

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
  const T = tanLat * tanLat
  const C = e2p * cosLat * cosLat
  const A = cosLat * ((lon * Math.PI / 180) - lonR0)

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latR
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latR)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latR)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latR)
  )

  const easting = Math.round(
    k0 * N * (A + (1 - T + C) * A * A * A / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * e2p) * Math.pow(A, 5) / 120)
    + 500000
  )

  const northingRaw = k0 * (
    M + N * tanLat * (A * A / 2
      + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * e2p) * Math.pow(A, 6) / 720)
  )
  // Southern hemisphere false northing
  const northing = Math.round(lat < 0 ? northingRaw + 10000000 : northingRaw)

  // UTM latitude band letter (C–X, skipping I and O)
  const LETTERS = 'CDEFGHJKLMNPQRSTUVWXX'
  const zoneLetter = LETTERS[Math.min(Math.max(Math.floor((lat + 80) / 8), 0), 20)]

  return { zone, zoneLetter, easting, northing,
    display: `${zone}${zoneLetter} ${easting} ${northing}` }
}

function minToHMS(totalMin) {
  const s  = Math.round(Math.abs(totalMin ?? 0) * 60)
  const h  = Math.floor(s / 3600)
  const m  = Math.floor((s % 3600) / 60)
  const sc = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`
}

// ── Print / PDF export ─────────────────────────────────────────────────────
// Opens a new tab with a print-ready HTML document containing one table per route.
// routesData: array of { results, routeName, variant, emptyWt, initFuel, waypoints }
export function exportFlightTable(routesData) {
  const now = new Date().toLocaleString('en-GB', { hour12: false })
  const th = s => `<th>${s}</th>`
  const td = (s, cls = '') => `<td class="${cls}">${s ?? '—'}</td>`

  const routeBlocks = routesData.map(({ results, waypoints: inputWpts = [], routeName, variant, emptyWt, initFuel }, idx) => {
    const { waypoints: perfWpts, legs: perfLegs = [], total_distance_nm, total_time_min, total_fuel_burned_lbs } = results
    const variantLabel = VARIANT_LABELS[variant] || variant
    const wptRows = perfWpts.map((w, i) => {
      const leg = perfLegs[i] || null
      const inW = inputWpts[i] || {}
      const lat = parseFloat(w.lat), lon = parseFloat(w.lon)
      const utm = (!isNaN(lat) && !isNaN(lon)) ? latLonToUTM(lat, lon) : null
      const seSpd = w.se_min_speed_kts, deSpd = w.de_min_speed_kts
      const fmtSE = seSpd == null ? 'N/A' : seSpd === 0 ? 'HOVER' : seSpd
      const fmtDE = deSpd == null ? 'N/A' : deSpd === 0 ? 'HOVER' : deSpd
      return `<tr>
        <td>${w.name}</td>
        ${td(Math.round(w.gross_weight_lbs).toLocaleString())} ${td(Math.round(w.fuel_remaining_lbs).toLocaleString())}
        ${td(leg ? leg.leg_time_min.toFixed(1) : '—')} ${td(w.cum_time_min.toFixed(1))}
        ${td(leg ? leg.distance_nm.toFixed(2) : '—')} ${td(w.cum_dist_nm)}
        ${td(w.oge_torque_required_pct + '%', !w.oge_feasible ? 'warn' : '')} ${td(w.ige_torque_required_pct + '%')} ${td(w.pa_available_pct + '%')}
        ${td(w.cruise_torque_pct + '%', w.cruise_torque_pct > 100 ? 'warn' : '')} ${td(w.fuel_flow_lb_hr)}
        ${td(w.wind_speed_kts > 0 ? w.wind_dir + '°' : '—')} ${td(w.wind_speed_kts > 0 ? w.wind_speed_kts : '—')}
        ${td(inW.surface_alt_ft || '—')} ${td(w.alt_ft)} ${td(w.tas_kts)} ${td(w.oat_c)}
        ${td(w.max_roc_fpm)} ${td(fmtSE)} ${td(fmtDE)}
        ${td(w.spare_pct + '%')} ${td(w.hold_type || '—')} ${td(w.hold_type ? w.hold_min : '—')} ${td(w.hold_type ? (inW.hold_speed_kts ?? '—') : '—')}
        ${td(w.oge_feasible ? 'GO' : 'NO-GO', w.oge_feasible ? 'ok' : 'warn')}
        ${td(utm ? `${utm.zone}${utm.zoneLetter}` : '—')} ${td(utm ? utm.easting : '—')} ${td(utm ? utm.northing : '—')}
      </tr>`
    }).join('')
    const HDRS = ['WP','GW (lbs)','FUEL (lbs)','LEG TIME','FLT TIME','LEG NM','RANGE NM','OGE%','IGE%','PA%','TRQ%','FF','WIND DIR','WIND KTS','SURF FT','ALT FT','TAS','OAT','CLIMB','SE KTS','DE KTS','SPARE%','HOLD TYPE','HOLD MIN','HOLD SPD','OGE','UTM ZONE','UTM EAST','UTM NORTH']

    return `<div class="${idx > 0 ? 'page-break' : ''}">
  <h1>RANER-X</h1>
  <div class="subtitle">APACHE · MISSION PLANNER — FLIGHT TABLE</div>
  ${routeName ? `<div class="route-name">${routeName}</div>` : ''}
  <div class="meta">
    <div class="meta-item"><label>DATE / TIME</label><span>${now}</span></div>
    <div class="meta-item"><label>VARIANT</label><span>${variantLabel}</span></div>
    <div class="meta-item"><label>EMPTY WEIGHT</label><span>${emptyWt} lbs</span></div>
    <div class="meta-item"><label>INITIAL FUEL</label><span>${initFuel} lbs</span></div>
    <div class="meta-item"><label>TOW</label><span>${(parseFloat(emptyWt || 0) + parseFloat(initFuel || 0)).toFixed(0)} lbs</span></div>
  </div>
  <div class="totals">
    <div><label>TOTAL DISTANCE</label><span>${total_distance_nm} nm</span></div>
    <div><label>TOTAL TIME</label><span>${total_time_min} min</span></div>
    <div><label>FUEL BURNED</label><span>${total_fuel_burned_lbs} lbs</span></div>
    <div><label>FUEL REMAINING</label><span>${perfWpts[perfWpts.length - 1]?.fuel_remaining_lbs} lbs</span></div>
  </div>
  <h2>WAYPOINTS — PERFORMANCE DATA</h2>
  <table>
    <thead><tr>${HDRS.map(th).join('')}</tr></thead>
    <tbody>${wptRows}</tbody>
  </table>
</div>`
  }).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>RANER-X Flight Table</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', monospace; background: #fff; color: #111; padding: 24px; font-size: 12px; }
    h1 { font-size: 20px; letter-spacing: 4px; margin-bottom: 2px; }
    .subtitle { font-size: 10px; letter-spacing: 3px; color: #555; margin-bottom: 6px; }
    .route-name { font-size: 13px; font-weight: bold; letter-spacing: 2px; color: #1e293b; margin-bottom: 12px; border-left: 3px solid #1e293b; padding-left: 8px; }
    .meta { display: flex; gap: 32px; margin-bottom: 16px; padding: 10px 14px; border: 1px solid #ccc; }
    .meta-item label { font-size: 9px; color: #777; display: block; letter-spacing: 1px; }
    .meta-item span  { font-weight: bold; font-size: 13px; }
    h2 { font-size: 11px; letter-spacing: 2px; color: #444; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #1e293b; color: #e2e8f0; padding: 5px 8px; text-align: left; font-size: 10px; white-space: nowrap; }
    td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
    tr:nth-child(even) td { background: #f8fafc; }
    .warn { color: #dc2626; font-weight: bold; }
    .ok   { color: #16a34a; font-weight: bold; }
    .totals { display: flex; gap: 24px; padding: 10px 14px; background: #f1f5f9; border: 1px solid #cbd5e1; margin-bottom: 16px; }
    .totals div label { font-size: 9px; color: #64748b; display: block; letter-spacing: 1px; }
    .totals div span  { font-weight: bold; font-size: 14px; }
    .page-break { page-break-before: always; break-before: page; padding-top: 24px; }
    @media print { body { padding: 12px; } .print-btn { display: none; } }
  </style>
</head>
<body>
  ${routeBlocks}
  <div style="margin-top:24px;text-align:right;font-size:10px;color:#94a3b8;letter-spacing:1px;">GENERATED BY RANER-X · APACHE MISSION PLANNER</div>
  <div style="margin-top:16px;text-align:center;" class="print-btn">
    <button onclick="window.print()" style="padding:8px 24px;font-size:12px;cursor:pointer;background:#1e293b;color:#fff;border:none;border-radius:4px;letter-spacing:1px;">PRINT / SAVE AS PDF</button>
  </div>
</body>
</html>`

  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
}

// ── Label lookup tables ────────────────────────────────────────────────────

const STATION_LABEL = { l_inboard: 'L-IB', r_inboard: 'R-IB', l_outboard: 'L-OB', r_outboard: 'R-OB' }
const STORE_LABEL   = { eft_230: 'EFT-230', hf_4rnd: 'HF ×4', eo_launcher: 'EO Launcher', rocket_m261: 'Rocket ×19', none: 'Empty' }

// ── Excel sheet builder (single route) ────────────────────────────────────

function _buildRouteSheet(results, mission, projectName, now) {
  const { waypoints: perfWpts, legs: perfLegs = [], total_distance_nm, total_time_min, total_fuel_burned_lbs } = results
  const {
    routeName,
    variant, emptyWt, initFuel,
    baseEmptyWt, crewWt, otherWt,
    storesHwWt, gunAmmoWt, missilesWt,
    gunAmmo, hfMissiles, eoMissiles, rocketRounds,
    stationsConfig, globalAtf,
    etfEng1, etfEng2,
    waypoints: inputWpts = [],
  } = mission

  const variantLabel = VARIANT_LABELS[variant] || variant
  const eftCount     = stationsConfig
    ? Object.values(stationsConfig).filter(s => s === 'eft_230').length : 0
  const stationRows  = stationsConfig
    ? Object.entries(stationsConfig).map(([st, id]) => [`  ${STATION_LABEL[st] || st}`, STORE_LABEL[id] || id])
    : []

  const wptHeader = [
    'WP',
    'GW (lbs)', 'Fuel (lbs)',
    'Leg Time (min)', 'Flt Time (min)',
    'Leg Range (nm)', 'Range (nm)',
    'OGE Req (%)', 'IGE Req (%)', 'PA Avail (%)',
    'TRQ (%)', 'FF (lb/hr)',
    'Wind Dir (°)', 'Wind Speed (kts)',
    'Surface Alt (ft)', 'Alt (ft)', 'Airspeed (kts)', 'OAT (°C)',
    'Climb FPM',
    'SE Min Speed (kts)', 'DE Min Speed (kts)',
    'Spare (%)', 'Hold Type', 'Hold Min', 'Hold Speed (kts)',
    'OGE',
    'UTM Zone', 'UTM Easting', 'UTM Northing',
  ]

  const wptRows = inputWpts.map((w, i) => {
    const p   = perfWpts[i] || {}
    const leg = perfLegs[i] || null
    const lat = parseFloat(w.lat)
    const lon = parseFloat(w.lon)
    const utm = (!isNaN(lat) && !isNaN(lon)) ? latLonToUTM(lat, lon) : null
    const seSpd = p.se_min_speed_kts, deSpd = p.de_min_speed_kts
    return [
      w.name,
      p.gross_weight_lbs != null ? Math.round(p.gross_weight_lbs) : '',
      p.fuel_remaining_lbs != null ? Math.round(p.fuel_remaining_lbs) : '',
      leg ? minToHMS(leg.leg_time_min) : '',
      p.cum_time_min != null ? minToHMS(p.cum_time_min) : '',
      leg ? leg.distance_nm : '',
      p.cum_dist_nm ?? '',
      p.oge_torque_required_pct ?? '',
      p.ige_torque_required_pct ?? '',
      p.pa_available_pct ?? '',
      p.cruise_torque_pct ?? '',
      p.fuel_flow_lb_hr ?? '',
      parseFloat(w.wind_dir) || 0,
      parseFloat(w.wind_speed_kts) || 0,
      parseFloat(w.surface_alt_ft) || '',
      parseFloat(w.alt_ft) || '',
      parseFloat(w.airspeed_kts) || '',
      parseFloat(w.oat_c) || '',
      p.max_roc_fpm ?? '',
      seSpd == null ? 'N/A' : seSpd === 0 ? 'HOVER' : seSpd,
      deSpd == null ? 'N/A' : deSpd === 0 ? 'HOVER' : deSpd,
      parseFloat(w.spare_pct) || 0,
      w.hold_type || '',
      w.hold_type ? (parseFloat(w.hold_min) || '') : '',
      w.hold_type ? (parseFloat(w.hold_speed_kts) || '') : '',
      p.oge_feasible != null ? (p.oge_feasible ? 'GO' : 'NO-GO') : '',
      utm ? `${utm.zone}${utm.zoneLetter}` : '',
      utm ? utm.easting  : '',
      utm ? utm.northing : '',
    ]
  })

  // Sheet layout: waypoint table first, then a metadata block below it
  const sheetData = [
    wptHeader,
    ...wptRows,
    [],
    ['RANER-X — APACHE MISSION PLANNER'],
    ['Project',  projectName],
    ['Route',    routeName || projectName],
    ['Date / Time', now],
    ['Variant',  variantLabel],
    [''],
    ['WEIGHT BREAKDOWN'],
    ['  Base Empty Weight (lbs)',  parseFloat(baseEmptyWt) || ''],
    ['  Crew Weight (lbs)',        parseFloat(crewWt) || ''],
    ['  Other Weight (lbs)',       parseFloat(otherWt) || 0],
    ['  Stores Hardware (lbs)',    storesHwWt ?? ''],
    ['  Gun Ammo Weight (lbs)',    gunAmmoWt ?? ''],
    ['  Missiles / Rockets (lbs)', missilesWt ?? ''],
    ['Configured Empty Weight (lbs)', parseFloat(emptyWt) || ''],
    ['Initial Fuel (lbs)',         parseFloat(initFuel) || ''],
    ['TOW (lbs)',                  (parseFloat(emptyWt || 0) + parseFloat(initFuel || 0)) || ''],
    [''],
    ['ENGINE'],
    ['  ETF Engine 1', parseFloat(etfEng1) || ''],
    ['  ETF Engine 2', parseFloat(etfEng2) || ''],
    [''],
    ['WING STORES'],
    ...stationRows,
    ['  Gun Ammo (rds)',       parseFloat(gunAmmo) || ''],
    ...(hfMissiles   > 0 ? [['  AGM-114 Hellfire',  hfMissiles]]   : []),
    ...(eoMissiles   > 0 ? [['  EO Missiles',        eoMissiles]]   : []),
    ...(rocketRounds > 0 ? [['  Rockets',            rocketRounds]] : []),
    ['  EFT Count (bidons)', eftCount],
    ['  ATF', globalAtf ?? ''],
    [''],
    ['TOTALS'],
    ['Total Distance (nm)',        total_distance_nm],
    ['Total Time (min)',           total_time_min],
    ['Total Fuel Burned (lbs)',    total_fuel_burned_lbs],
    ['Final Fuel Remaining (lbs)', perfWpts[perfWpts.length - 1]?.fuel_remaining_lbs],
  ]

  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  ws['!cols'] = [
    { wch: 14 },                                              // WP
    { wch: 10 }, { wch: 10 },                                // GW, Fuel
    { wch: 14 }, { wch: 14 },                                // Leg Time, Flt Time
    { wch: 14 }, { wch: 10 },                                // Leg Range, Range
    { wch: 12 }, { wch: 12 }, { wch: 12 },                  // OGE, IGE, PA
    { wch: 10 }, { wch: 10 },                                // TRQ, FF
    { wch: 11 }, { wch: 13 },                                // Wind Dir, Wind Speed
    { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 10 },    // Surf Alt, Alt, Airspeed, OAT
    { wch: 12 },                                              // Climb FPM
    { wch: 18 }, { wch: 18 },                                // SE, DE
    { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 16 },    // Spare, Hold Type, Hold Min, Hold Speed
    { wch: 8 },                                               // OGE
    { wch: 10 }, { wch: 12 }, { wch: 12 },                  // UTM Zone, Easting, Northing
  ]
  return ws
}

// ── Excel export — one sheet per route, filename = project name ────────────
// routesData: array of { results, routeName, variant, emptyWt, initFuel, waypoints, … }
export function exportExcel(routesData, projectName = 'Ilana') {
  const now = new Date().toLocaleString('en-GB', { hour12: false })
  const wb  = XLSX.utils.book_new()

  // Deduplicate sheet names (Excel rejects duplicates)
  const usedNames = new Set()
  for (const mission of routesData) {
    const ws   = _buildRouteSheet(mission.results, mission, projectName, now)
    let base   = (mission.routeName || 'Route').replace(/[\\/?*[\]:]/g, '_').substring(0, 31) || 'Route'
    let sheetName = base
    let n = 2
    while (usedNames.has(sheetName)) { sheetName = base.substring(0, 28) + `(${n++})` }
    usedNames.add(sheetName)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  const safeFile = projectName.trim().replace(/[^\w\s\-]/g, '_') || 'mission'
  XLSX.writeFile(wb, `${safeFile}.xlsx`)
}

// ── Reverse lookup maps used during import ─────────────────────────────────
const VARIANT_KEY = Object.fromEntries(Object.entries(VARIANT_LABELS).map(([k, v]) => [v, k]))
const STORE_KEY   = { 'EFT-230': 'eft_230', 'HF ×4': 'hf_4rnd', 'EO Launcher': 'eo_launcher', 'Rocket ×19': 'rocket_m261', 'Empty': 'none' }
const STATION_KEY = { 'L-IB': 'l_inboard', 'R-IB': 'r_inboard', 'L-OB': 'l_outboard', 'R-OB': 'r_outboard' }

// ── Excel import ───────────────────────────────────────────────────────────
// Reads the first sheet of an exported workbook and reconstructs mission + waypoints.
export function importFromExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })

        const sheetName = wb.SheetNames[0]
        if (!sheetName) throw new Error('No sheets found')
        const ws      = wb.Sheets[sheetName]
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Locate the waypoint header row (first row where column 0 is exactly 'WP')
        const wptHeaderIdx = allRows.findIndex(r => String(r[0]).trim() === 'WP')
        if (wptHeaderIdx < 0) throw new Error('Waypoint header row not found')

        // Find the first blank row after the header to delimit the WP data block
        let wptEndIdx = allRows.length
        for (let i = wptHeaderIdx + 1; i < allRows.length; i++) {
          if (String(allRows[i][0] ?? '').trim() === '') { wptEndIdx = i; break }
        }

        // Merge rows above the WP table (legacy format) with rows below it (current format)
        // into a single flat label→value map for easy field lookup
        const summaryRows = [
          ...allRows.slice(0, wptHeaderIdx),
          ...allRows.slice(wptEndIdx),
        ]
        const kv = {}
        for (const row of summaryRows) {
          if (row[0] != null && row[0] !== '' && row[1] != null && row[1] !== '') {
            kv[String(row[0]).trim()] = row[1]
          }
        }

        // Extract station→store mapping from summary rows that match STATION_KEY labels
        const stations = {}
        for (const row of summaryRows) {
          const label = String(row[0] ?? '').trim()
          const stKey = STATION_KEY[label]
          if (stKey) stations[stKey] = STORE_KEY[String(row[1]).trim()] ?? 'eft_230'
        }

        const mission = {
          project_name:      String(kv['Project']                     ?? 'Ilana'),
          route_name:        String(kv['Route']                       ?? sheetName),
          variant:           VARIANT_KEY[String(kv['Variant'] ?? '')] ?? 'LB',
          base_empty_wt:     String(kv['Base Empty Weight (lbs)']     ?? kv['  Base Empty Weight (lbs)'] ?? 13200),
          other_wt:          String(kv['Other Weight (lbs)']          ?? kv['  Other Weight (lbs)'] ?? 0),
          initial_fuel_lbs:  String(kv['Initial Fuel (lbs)']          ?? 2500),
          etf_eng1:          String(kv['ETF Engine 1']                ?? kv['  ETF Engine 1'] ?? 0.95),
          etf_eng2:          String(kv['ETF Engine 2']                ?? kv['  ETF Engine 2'] ?? 0.95),
          gun_ammo:          String(kv['Gun Ammo (rds)']              ?? kv['  Gun Ammo (rds)'] ?? 500),
          hf_missiles:       Number(kv['AGM-114 Hellfire']            ?? kv['  AGM-114 Hellfire'] ?? 0),
          eo_missiles:       Number(kv['EO Missiles']                 ?? kv['  EO Missiles'] ?? 0),
          rocket_rounds:     Number(kv['Rockets']                     ?? kv['  Rockets'] ?? 0),
          // Only restore station config if all 4 stations were found
          stationsConfig:    Object.keys(stations).length === 4 ? stations : null,
        }

        // Parse waypoint rows from the WP data block
        const wptDataRows = allRows.slice(wptHeaderIdx, wptEndIdx)
        const hdr = wptDataRows[0].map(h => String(h).trim())
        const col = name => hdr.indexOf(name)

        const waypoints = wptDataRows.slice(1).filter(r => String(r[col('WP')] ?? '').trim() !== '').map(r => {
          const zoneStr    = String(r[col('UTM Zone')] ?? '').trim()
          const easting    = Number(r[col('UTM Easting')])
          const northing   = Number(r[col('UTM Northing')])
          const zoneNum    = parseInt(zoneStr)
          const zoneLetter = zoneStr.replace(/\d/g, '') || 'N'

          let lat = '', lon = ''
          if (zoneNum && !isNaN(easting) && !isNaN(northing)) {
            const ll = utmToLatLon(zoneNum, zoneLetter, easting, northing)
            lat = String(Math.round(ll.lat * 1000000) / 1000000)
            lon = String(Math.round(ll.lon * 1000000) / 1000000)
          }

          const v = k => { const c = col(k); return c >= 0 ? r[c] : '' }
          return {
            name:           String(v('WP')),
            lat, lon,
            alt_ft:         String(v('Alt (ft)') ?? ''),
            surface_alt_ft: String(v('Surface Alt (ft)') ?? ''),
            airspeed_kts:   String(v('Airspeed (kts)') ?? '120'),
            oat_c:          String(v('OAT (°C)') ?? '25'),
            oat_auto:       Number(v('OAT Auto') ?? 0) === 1,
            atf:            String(v('ATF') ?? '1.0'),
            hold_type:      v('Hold Type') || null,
            hold_min:       String(v('Hold Min') ?? '5'),
            hold_speed_kts: String(v('Hold Speed (kts)') ?? '80'),
            spare_pct:      String(v('Spare (%)') ?? '0'),
            wind_dir:       String(v('Wind Dir (°)') ?? '0'),
            wind_speed_kts: String(v('Wind Speed (kts)') ?? '0'),
          }
        })

        resolve({ mission, waypoints })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}
