import React, { useState, useEffect, useCallback } from 'react'
import * as api from '../api.js'

export default function NotesPanel({
  routes,
  settings,
  bingoTargetMode,
  onRequestMapClick,
  onCancelMapClick,
  pendingBingoTarget,
  onBingoTargetConsumed,
  onClose,
}) {
  const [selectedRouteId, setSelectedRouteId] = useState(routes.length > 0 ? routes[0].id : null)
  const [windScenarios, setWindScenarios] = useState([])
  const [windResults, setWindResults] = useState([])
  const [calcLoading, setCalcLoading] = useState(false)

  const [bingoPairs, setBingoPairs] = useState([])
  const [bingoResults, setBingoResults] = useState([])
  const [bingoCalcLoading, setBingoCalcLoading] = useState(false)
  const [editingPairId, setEditingPairId] = useState(null)

  const [windIdCounter, setWindIdCounter] = useState(0)
  const [bingoIdCounter, setBingoIdCounter] = useState(0)
  const [minimized, setMinimized] = useState(false)
  const [activeTab, setActiveTab] = useState('wind')

  // Ui state for wind scenario builder
  const [windMode, setWindMode] = useState('HEADWIND')
  const [windDirection, setWindDirection] = useState(270)
  const [windSpeed, setWindSpeed] = useState(15)

  // Ui state for bingo pair builder
  const [newBingoSourceIdx, setNewBingoSourceIdx] = useState(0)

  const route = routes.find(r => r.id === selectedRouteId)

  // ─────────────────────────────────────────────────────────────
  // Helper functions
  // ─────────────────────────────────────────────────────────────

  function legBearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180
    const toDeg = (rad) => (rad * 180) / Math.PI
    const dLon = toRad(lon2 - lon1)
    const y = Math.sin(dLon) * Math.cos(toRad(lat2))
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
    const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360
    return bearing
  }

  function haversineNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065 // Earth radius in NM
    const toRad = (deg) => (deg * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
  }

  function applyWindScenario(waypoints, scenario) {
    if (scenario.mode === 'FIXED') {
      return waypoints.map(w => ({
        ...w,
        wind_dir: scenario.direction,
        wind_speed_kts: scenario.speed,
      }))
    }

    const offsetMap = {
      HEADWIND: 0,
      TAILWIND: 180,
      RIGHT_CROSS: 90,
      LEFT_CROSS: 270,
    }
    const baseOffset = offsetMap[scenario.mode] ?? 0

    return waypoints.map((w, i) => {
      const nextW = waypoints[i + 1]
      if (!nextW) return w

      const bearing = legBearing(w.lat, w.lon, nextW.lat, nextW.lon)
      const windDir = (bearing + baseOffset + 360) % 360

      return {
        ...w,
        wind_dir: windDir,
        wind_speed_kts: scenario.speed,
      }
    })
  }

  function buildBasePayload(rt, settings) {
    if (!rt) return {}
    const cfg = rt.config || {}
    const emptyWt = Math.round(
      (parseFloat(cfg.baseEmptyWt) || 13200)
      + (settings?.crewWtDefault || 400)
      + (parseFloat(cfg.otherWt) || 0)
      + (settings?.chaffFlareWtDefault || 60)
      + (cfg.fcrOn ? (settings?.fcrWeight || 0) : 0)
      + (cfg.compodOn ? (settings?.compodWeight || 0) : 0)
    )
    return {
      variant: cfg.variant || 'LB',
      empty_weight_lbs: emptyWt,
      n_bidons: 0,
      delta_f: Math.round(((parseFloat(cfg.globalAtf) || 1.0) - 1) * 100 * 1000) / 1000,
      etf_eng1: parseFloat(cfg.etfEng1) || 0.95,
      etf_eng2: parseFloat(cfg.etfEng2) || 0.95,
      wca_thresholds: {
        torque_pct: null,
        pa_pct: null,
        oge_flag: false,
        ige_flag: false,
      },
    }
  }

  function isaTemperature(altFt) {
    return 59 - 0.00356 * altFt
  }

  // ─────────────────────────────────────────────────────────────
  // Wind calculation
  // ─────────────────────────────────────────────────────────────

  const calculateWind = useCallback(async () => {
    if (!route || windScenarios.length === 0) return
    if (route.waypoints.length < 2) {
      alert('Route must have at least 2 waypoints')
      return
    }

    setCalcLoading(true)
    const initialFuel = parseFloat(route.config?.initFuel) || 0
    const basePayload = buildBasePayload(route, settings)

    try {
      const promises = windScenarios.map(async (scenario) => {
        try {
          const modifiedWaypoints = applyWindScenario(route.waypoints, scenario)
          // Ensure all required waypoint fields are present
          const validWaypoints = modifiedWaypoints.map(w => ({
            name: w.name || '',
            lat: parseFloat(w.lat),
            lon: parseFloat(w.lon),
            alt_ft: parseFloat(w.alt_ft),
            airspeed_kts: parseFloat(w.airspeed_kts),
            oat_c: parseFloat(w.oat_c),
            atf: parseFloat(w.atf) || 1.0,
            wind_dir: Math.round((parseFloat(w.wind_dir) % 360 + 360) % 360),
            wind_speed_kts: Math.max(0, parseFloat(w.wind_speed_kts)),
            hold_type: w.hold_type || null,
            hold_min: parseFloat(w.hold_min) || 0,
            hold_speed_kts: parseFloat(w.hold_speed_kts) || 80,
            spare_pct: parseInt(w.spare_pct) || 0,
          }))
          const payload = {
            ...basePayload,
            initial_fuel_lbs: initialFuel,
            waypoints: validWaypoints,
          }
          const result = await api.calculateFlightPlan(payload)
          return { scenarioId: scenario.id, status: 'done', data: result, error: null }
        } catch (err) {
          console.error('Wind scenario error:', err)
          return { scenarioId: scenario.id, status: 'error', data: null, error: err.message }
        }
      })

      const results = await Promise.all(promises)
      setWindResults(results)
    } finally {
      setCalcLoading(false)
    }
  }, [route, windScenarios])

  // ─────────────────────────────────────────────────────────────
  // Bingo calculation
  // ─────────────────────────────────────────────────────────────

  const calculateBingo = useCallback(async () => {
    if (!route || windResults.length === 0 || bingoPairs.length === 0) return

    const allWindDone = windResults.every(r => r.status === 'done')
    if (!allWindDone) {
      alert('Calculate wind scenarios first')
      return
    }

    const allPairsResolved = bingoPairs.every(p => p.targetLatLon && !p.editingUtm)
    if (!allPairsResolved) {
      alert('All bingo pairs must have resolved targets')
      return
    }

    setBingoCalcLoading(true)
    const basePayload = buildBasePayload(route, settings)

    try {
      const results = []

      for (const pair of bingoPairs) {
        const cells = []

        for (const windResult of windResults) {
          if (windResult.status !== 'done') {
            cells.push({ scenarioId: windResult.scenarioId, status: 'error', time_min: null, fuel_needed_lbs: null, distance_nm: null })
            continue
          }

          try {
            const scenario = windScenarios.find(s => s.id === windResult.scenarioId)
            const srcWpt = windResult.data.waypoints[pair.sourceWptIdx]
            if (!srcWpt) throw new Error('Invalid source waypoint index')

            // Bingo distance
            const distNm = haversineNm(srcWpt.lat, srcWpt.lon, pair.targetLatLon.lat, pair.targetLatLon.lon)

            // Wind direction for bingo leg
            const bearing = legBearing(srcWpt.lat, srcWpt.lon, pair.targetLatLon.lat, pair.targetLatLon.lon)
            let bingoWindDir = scenario.direction

            if (scenario.mode === 'FIXED') {
              bingoWindDir = scenario.direction
            } else {
              const offsetMap = {
                HEADWIND: 0,
                TAILWIND: 180,
                RIGHT_CROSS: 90,
                LEFT_CROSS: 270,
              }
              bingoWindDir = (bearing + (offsetMap[scenario.mode] ?? 0) + 360) % 360
            }

            // 2-waypoint bingo payload
            const oat = srcWpt.oat_c ?? 15
            const altFt = srcWpt.alt_ft ?? 0

            const bingoPayload = {
              ...basePayload,
              initial_fuel_lbs: srcWpt.fuel_remaining_lbs,
              waypoints: [
                {
                  name: `WP${pair.sourceWptIdx + 1}`,
                  lat: parseFloat(srcWpt.lat),
                  lon: parseFloat(srcWpt.lon),
                  alt_ft: parseFloat(altFt),
                  airspeed_kts: 120,
                  oat_c: parseFloat(oat),
                  atf: 1.0,
                  wind_dir: Math.round(bingoWindDir),
                  wind_speed_kts: scenario.speed,
                },
                {
                  name: pair.targetLabel || 'TARGET',
                  lat: parseFloat(pair.targetLatLon.lat),
                  lon: parseFloat(pair.targetLatLon.lon),
                  alt_ft: parseFloat(pair.targetElev ?? 0),
                  airspeed_kts: 120,
                  oat_c: parseFloat(isaTemperature(pair.targetElev ?? 0)),
                  atf: 1.0,
                  wind_dir: Math.round(bingoWindDir),
                  wind_speed_kts: scenario.speed,
                },
              ],
            }

            const bingoResult = await api.calculateFlightPlan(bingoPayload)
            const legFuel = bingoResult.legs?.[0]?.fuel_burned_lbs ?? 0
            const legTime = bingoResult.legs?.[0]?.leg_time_min ?? 0
            const fuelNeeded = settings.jokerFuel + legFuel

            cells.push({
              scenarioId: windResult.scenarioId,
              status: 'done',
              time_min: legTime,
              fuel_needed_lbs: fuelNeeded,
              distance_nm: distNm,
            })
          } catch (err) {
            cells.push({ scenarioId: windResult.scenarioId, status: 'error', time_min: null, fuel_needed_lbs: null, distance_nm: null })
          }
        }

        results.push({ pairId: pair.id, cells })
      }

      setBingoResults(results)
    } finally {
      setBingoCalcLoading(false)
    }
  }, [route, windResults, windScenarios, bingoPairs, settings])

  // ─────────────────────────────────────────────────────────────
  // Map click handshake
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pendingBingoTarget || editingPairId === null) return

    const elevFetch = async () => {
      try {
        const { elevation_ft } = await api.fetchElevation(pendingBingoTarget.lat, pendingBingoTarget.lon)
        const elev = Math.round(elevation_ft)
        setBingoPairs(prev =>
          prev.map(p =>
            p.id === editingPairId
              ? {
                  ...p,
                  targetLatLon: pendingBingoTarget,
                  targetElev: elev,
                  editingUtm: false,
                }
              : p
          )
        )
      } catch (err) {
        setBingoPairs(prev =>
          prev.map(p =>
            p.id === editingPairId
              ? {
                  ...p,
                  targetLatLon: pendingBingoTarget,
                  targetElev: 0,
                  editingUtm: false,
                }
              : p
          )
        )
      }
    }

    elevFetch()
    onBingoTargetConsumed()
    setEditingPairId(null)
    setMinimized(false)
  }, [pendingBingoTarget, editingPairId, onBingoTargetConsumed])

  // ─────────────────────────────────────────────────────────────
  // Wind scenario management
  // ─────────────────────────────────────────────────────────────

  const getWindModeName = (mode) => {
    const names = {
      FIXED: 'Fixed',
      HEADWIND: 'Headwind',
      TAILWIND: 'Tailwind',
      RIGHT_CROSS: 'Right Crosswind',
      LEFT_CROSS: 'Left Crosswind',
    }
    return names[mode] || mode
  }

  const addWindScenario = () => {
    const newId = windIdCounter
    setWindIdCounter(windIdCounter + 1)

    const scenario = {
      id: newId,
      mode: windMode,
      direction: windMode === 'FIXED' ? windDirection : 0,
      speed: windSpeed,
    }

    setWindScenarios([...windScenarios, scenario])
    setWindResults(prev => [...prev, { scenarioId: newId, status: 'idle', data: null, error: null }])
  }

  const deleteWindScenario = (id) => {
    setWindScenarios(windScenarios.filter(s => s.id !== id))
    setWindResults(windResults.filter(r => r.scenarioId !== id))
  }

  const getWindLabel = (scenario) => {
    if (scenario.mode === 'FIXED') {
      return `${getWindModeName(scenario.mode)} ${Math.round(scenario.direction)}°/${scenario.speed}KT`
    }
    return `${getWindModeName(scenario.mode)} ${scenario.speed}KT`
  }

  // ─────────────────────────────────────────────────────────────
  // Bingo pair management
  // ─────────────────────────────────────────────────────────────

  const addBingoPair = () => {
    if (bingoPairs.length >= 5) return

    const newId = bingoIdCounter
    setBingoIdCounter(bingoIdCounter + 1)

    const newPair = {
      id: newId,
      sourceWptIdx: 0,
      targetLatLon: null,
      targetElev: null,
      targetLabel: '',
      coordinateMode: 'utm', // 'utm' | 'geo'
      utmZone: '36',
      utmEasting: '',
      utmNorthingPfx: '',
      utmNorthing: '',
      geoLat: '',
      geoLon: '',
    }

    setBingoPairs([...bingoPairs, newPair])
  }

  const deleteBingoPair = (id) => {
    setBingoPairs(bingoPairs.filter(p => p.id !== id))
    setBingoResults(bingoResults.filter(r => r.pairId !== id))
  }

  const updateBingoSource = (id, sourceWptIdx) => {
    setBingoPairs(bingoPairs.map(p => (p.id === id ? { ...p, sourceWptIdx } : p)))
  }

  const updateBingoTarget = (id, targetLatLon) => {
    setBingoPairs(bingoPairs.map(p => (p.id === id ? { ...p, targetLatLon } : p)))
  }

  const updateBingoLabel = (id, label) => {
    setBingoPairs(bingoPairs.map(p => (p.id === id ? { ...p, targetLabel: label } : p)))
  }

  const updateBingoFromUTM = useCallback(async (pairId, zone, easting, northing) => {
    if (!zone || !easting || !northing) return
    try {
      const { lat, lon } = await api.utmToLatLon(zone, easting, northing)
      const { elevation_ft } = await api.fetchElevation(lat, lon)
      const elev = Math.round(elevation_ft)
      setBingoPairs(prev =>
        prev.map(p =>
          p.id === pairId
            ? {
                ...p,
                targetLatLon: { lat, lon },
                targetElev: elev,
              }
            : p
        )
      )
    } catch (err) {
      // silently ignore invalid UTM
    }
  }, [])

  const updateBingoFromLatLon = useCallback(async (pairId, lat, lon) => {
    try {
      const { elevation_ft } = await api.fetchElevation(lat, lon)
      const elev = Math.round(elevation_ft)
      setBingoPairs(prev =>
        prev.map(p =>
          p.id === pairId
            ? {
                ...p,
                targetLatLon: { lat, lon },
                targetElev: elev,
              }
            : p
        )
      )
    } catch (err) {
      // silently ignore
    }
  }, [])

  const getPairLabel = (pair) => {
    if (!route) return ''
    const srcWpt = route.waypoints[pair.sourceWptIdx]
    const srcLabel = srcWpt ? `WP${pair.sourceWptIdx + 1}` : '?'
    const tgtLabel = pair.targetLabel || (pair.targetLatLon ? `${pair.targetLatLon.lat.toFixed(3)}°/${pair.targetLatLon.lon.toFixed(3)}°` : 'TBD')
    return `${srcLabel} → ${tgtLabel}`
  }

  const bingoWindDone = windResults.every(r => r.status !== 'idle' && r.status !== 'loading')

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  const s = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    panel: {
      width: 620,
      maxHeight: '85vh',
      overflowY: 'auto',
      backgroundColor: '#1a1a1a',
      color: '#fff',
      borderRadius: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      fontFamily: 'Menlo, monospace',
      fontSize: 12,
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottom: '1px solid #333',
      fontWeight: 'bold',
      fontSize: 14,
    },
    routeSelector: {
      padding: 12,
      borderBottom: '1px solid #333',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      justifyContent: 'space-between',
    },
    routeSelectorLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: '#a0a0a0',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    routeInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    },
    tabBar: {
      display: 'flex',
      borderBottom: '1px solid #333',
      gap: 0,
    },
    tabButton: {
      padding: '8px 20px',
      fontSize: 11,
      fontWeight: 700,
      cursor: 'pointer',
      border: 'none',
      backgroundColor: 'transparent',
      color: '#666',
      borderBottom: '2px solid transparent',
      transition: 'all 0.2s',
    },
    tabButtonActive: {
      color: '#22c55e',
      borderBottom: '2px solid #22c55e',
    },
    tabContent: {
      flex: 1,
      overflowY: 'auto',
    },
    section: {
      padding: 16,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: 700,
      marginBottom: 12,
      color: '#a0a0a0',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    button: {
      padding: '6px 12px',
      fontSize: 11,
      fontWeight: 600,
      border: '1px solid #444',
      borderRadius: 4,
      backgroundColor: '#222',
      color: '#fff',
      cursor: 'pointer',
      marginRight: 8,
      marginBottom: 8,
    },
    buttonPrimary: {
      padding: '6px 12px',
      fontSize: 11,
      fontWeight: 600,
      border: '1.5px solid #22c55e',
      borderRadius: 4,
      backgroundColor: '#0a3a1a',
      color: '#22c55e',
      cursor: 'pointer',
    },
    buttonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    chip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      backgroundColor: '#333',
      borderRadius: 4,
      fontSize: 11,
      marginRight: 8,
      marginBottom: 8,
    },
    input: {
      padding: '4px 8px',
      fontSize: 11,
      backgroundColor: '#222',
      border: '1px solid #444',
      borderRadius: 3,
      color: '#fff',
      marginRight: 8,
      boxSizing: 'border-box',
      height: 24,
      lineHeight: '16px',
    },
    select: {
      padding: '4px 8px',
      fontSize: 11,
      backgroundColor: '#222',
      border: '1px solid #444',
      borderRadius: 3,
      color: '#fff',
      marginRight: 8,
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 11,
      marginTop: 12,
    },
    td: {
      padding: '6px 8px',
      borderBottom: '1px solid #333',
      textAlign: 'left',
    },
    tdCenter: {
      padding: '6px 8px',
      borderBottom: '1px solid #333',
      textAlign: 'center',
    },
    tdWarn: {
      padding: '6px 8px',
      borderBottom: '1px solid #333',
      textAlign: 'center',
      color: '#ff6b6b',
      fontWeight: 600,
    },
  }

  return (
    <div style={{ ...s.overlay, pointerEvents: minimized ? 'none' : 'auto' }} onClick={onClose}>
      <div style={{ ...s.panel, display: minimized ? 'none' : 'flex' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <span>✎ WIND ANALYSIS & BINGO</span>
          <button style={{ ...s.button, marginRight: 0 }} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Route Selector */}
        <div style={s.routeSelector}>
          <select style={{ ...s.select, minWidth: 200, flex: 1 }} value={selectedRouteId || ''} onChange={e => setSelectedRouteId(parseInt(e.target.value))}>
            {routes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {route && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ {route.waypoints?.length ?? 0} waypoints</span>}
        </div>

        {/* Tab Bar */}
        <div style={s.tabBar}>
          {[['wind', 'WIND SCENARIOS'], ['bingo', 'BINGO CALC']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{ ...s.tabButton, ...(activeTab === key ? s.tabButtonActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={s.tabContent}>
          {/* SECTION 1: WIND SCENARIOS */}
          {activeTab === 'wind' && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Wind Scenarios</div>

          {/* Wind mode + speed + ADD all on one line */}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {/* Wind mode buttons */}
            {[
              { mode: 'HEADWIND', label: 'Headwind' },
              { mode: 'TAILWIND', label: 'Tailwind' },
              { mode: 'R-Cross', label: 'R-Cross' },
              { mode: 'LEFT_CROSS', label: 'L-Cross' },
              { mode: 'FIXED', label: 'Fixed' },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setWindMode(mode === 'R-Cross' ? 'RIGHT_CROSS' : mode)}
                style={{
                  ...s.button,
                  padding: '4px 8px',
                  fontSize: 10,
                  borderColor: windMode === (mode === 'R-Cross' ? 'RIGHT_CROSS' : mode) ? '#22c55e' : '#444',
                  backgroundColor: windMode === (mode === 'R-Cross' ? 'RIGHT_CROSS' : mode) ? '#0a3a1a' : '#222',
                  color: windMode === (mode === 'R-Cross' ? 'RIGHT_CROSS' : mode) ? '#22c55e' : '#fff',
                  marginRight: 0,
                }}
              >
                {label}
              </button>
            ))}

            {/* Direction input for FIXED mode */}
            {windMode === 'FIXED' && (
              <input
                type="number"
                min="0"
                max="360"
                style={{ ...s.input, width: 60, marginRight: 0, height: 28, padding: '0 6px', fontSize: 10, boxSizing: 'border-box' }}
                placeholder="Dir°"
                value={windDirection}
                onChange={e => setWindDirection(parseInt(e.target.value) || 0)}
              />
            )}

            {/* Speed spinner */}
            <button style={{ ...s.button, padding: '0 6px', marginRight: 0, fontSize: 10, height: 28, boxSizing: 'border-box' }} onClick={() => setWindSpeed(Math.max(0, windSpeed - 5))}>
              −
            </button>
            <input
              type="number"
              min="0"
              style={{ ...s.input, width: 45, marginRight: 0, textAlign: 'center', fontSize: 10, padding: '0 4px', height: 28, boxSizing: 'border-box' }}
              value={windSpeed}
              onChange={e => setWindSpeed(parseInt(e.target.value) || 0)}
            />
            <button style={{ ...s.button, padding: '0 6px', marginRight: 0, fontSize: 10, height: 28, boxSizing: 'border-box' }} onClick={() => setWindSpeed(windSpeed + 5)}>
              +
            </button>

            {/* ADD button */}
            <button style={{ ...s.button, marginRight: 0, fontSize: 10, padding: '0 10px', height: 28, boxSizing: 'border-box' }} onClick={addWindScenario}>
              + ADD
            </button>
          </div>

          {windScenarios.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {windScenarios.map(scenario => (
                <div key={scenario.id} style={s.chip}>
                  {getWindLabel(scenario)}
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 11 }}
                    onClick={() => deleteWindScenario(scenario.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            style={{
              ...s.buttonPrimary,
              ...(calcLoading || !route || route.waypoints.length < 2 || windScenarios.length === 0 ? s.buttonDisabled : {}),
            }}
            onClick={calculateWind}
            disabled={calcLoading || !route || route.waypoints.length < 2 || windScenarios.length === 0}
          >
            {calcLoading ? 'CALCULATING...' : 'CALCULATE'}
          </button>

          {windResults.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {windResults.map((result, idx) => {
                const scenario = windScenarios.find(s => s.id === result.scenarioId)
                if (!scenario) return null
                const data = result.data

                if (result.status === 'error') {
                  return (
                    <div key={result.scenarioId} style={{ padding: 8, backgroundColor: '#2a0000', borderRadius: 4, marginBottom: 8, color: '#ff6b6b', fontSize: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{getWindLabel(scenario)}: ERROR</div>
                      <div style={{ fontSize: 9, color: '#ffaaaa' }}>{result.error || 'Unknown error'}</div>
                    </div>
                  )
                }

                if (result.status === 'done' && data) {
                  const totalDist = data.total_distance_nm ?? 0
                  const totalTime = data.total_time_min ?? 0
                  const totalFuel = data.total_fuel_burned_lbs ?? 0

                  return (
                    <div key={result.scenarioId} style={{ padding: '6px 10px', backgroundColor: '#1a2a1a', borderRadius: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#22c55e' }}>
                          {getWindLabel(scenario)}
                        </span>
                        <span style={{ fontSize: 11, color: '#ccc' }}>
                          {totalDist.toFixed(1)} NM &nbsp;|&nbsp;
                          {Math.floor(totalTime)}:{String(Math.round((totalTime % 1) * 60)).padStart(2, '0')} &nbsp;|&nbsp;
                          {Math.round(totalFuel)} LBS
                        </span>
                      </div>
                    </div>
                  )
                }

                return null
              })}
            </div>
          )}
        </div>
          )}

          {/* SECTION 2: BINGO */}
          {activeTab === 'bingo' && (
          <div style={s.section}>
          <div style={s.sectionTitle}>Bingo Calculator</div>

          {!bingoWindDone && (
            <div style={{ padding: 8, backgroundColor: '#2a2200', borderRadius: 4, marginBottom: 12, color: '#ffb800', fontSize: 11 }}>
              ⚠ Calculate wind scenarios first
            </div>
          )}

          {bingoPairs.map((pair, idx) => {
            const srcWpt = route?.waypoints[pair.sourceWptIdx]

            return (
              <div key={pair.id} style={{ padding: 12, backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 4, marginBottom: 8 }}>
                {/* Source waypoint selector */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>Source</div>
                  <select
                    style={s.select}
                    value={pair.sourceWptIdx}
                    onChange={e => updateBingoSource(pair.id, parseInt(e.target.value))}
                  >
                    {route?.waypoints.map((w, i) => (
                      <option key={i} value={i}>
                        WP{i + 1}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target coordinates */}
                {!pair.targetLatLon ? (
                  <div>
                    <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 6 }}>Target</div>

                    {/* UTM / GEO toggle */}
                    <div style={{ display: 'flex', marginBottom: 10, borderRadius: 3, overflow: 'hidden', border: '1px solid #444', height: 28 }}>
                      {['utm', 'geo'].map(mode => (
                        <button
                          key={mode}
                          onClick={() => setBingoPairs(bingoPairs.map(p => p.id === pair.id ? { ...p, coordinateMode: mode } : p))}
                          style={{
                            flex: 1,
                            padding: 0,
                            fontSize: 10,
                            border: 'none',
                            cursor: 'pointer',
                            background: pair.coordinateMode === mode ? '#22c55e' : '#222',
                            color: pair.coordinateMode === mode ? '#000' : '#fff',
                            fontWeight: 700,
                            letterSpacing: 1,
                          }}
                        >
                          {mode.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {/* UTM inputs */}
                    {pair.coordinateMode === 'utm' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                          <div style={{ fontSize: 9, color: '#999' }}>ZONE</div>
                          <input
                            type="text"
                            maxLength={2}
                            value={pair.utmZone}
                            onChange={e => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 2)
                              const newPair = { ...pair, utmZone: val }
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? newPair : p))
                              if (val && newPair.utmEasting.length === 6 && newPair.utmNorthing.length === 6) {
                                updateBingoFromUTM(pair.id, parseInt(val), parseInt(newPair.utmEasting), parseInt(newPair.utmNorthingPfx + newPair.utmNorthing))
                              }
                            }}
                            placeholder="36"
                            style={{ ...s.input, width: 34, textAlign: 'center', marginRight: 0, height: 24 }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#999' }}>N</div>
                          <input
                            type="text"
                            maxLength={1}
                            value={pair.utmNorthingPfx}
                            onChange={e => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 1)
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? { ...p, utmNorthingPfx: val } : p))
                            }}
                            placeholder="3"
                            style={{ ...s.input, width: 26, textAlign: 'center', marginRight: 0, height: 24 }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#999' }}>EASTING</div>
                          <input
                            type="text"
                            maxLength={6}
                            value={pair.utmEasting}
                            onChange={e => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                              const newPair = { ...pair, utmEasting: val }
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? newPair : p))
                              if (pair.utmZone && val.length === 6 && pair.utmNorthing.length === 6) {
                                updateBingoFromUTM(pair.id, parseInt(pair.utmZone), parseInt(val), parseInt(pair.utmNorthing + pair.utmNorthingPfx))
                              }
                            }}
                            placeholder="674335"
                            style={{ ...s.input, width: 64, marginRight: 0, height: 24 }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#999' }}>NORTHING</div>
                          <input
                            type="text"
                            maxLength={6}
                            value={pair.utmNorthing}
                            onChange={e => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                              const newPair = { ...pair, utmNorthing: val }
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? newPair : p))
                              if (pair.utmZone && pair.utmEasting.length === 6 && val.length === 6) {
                                updateBingoFromUTM(pair.id, parseInt(pair.utmZone), parseInt(pair.utmEasting), parseInt(val + pair.utmNorthingPfx))
                              }
                            }}
                            placeholder="480879"
                            style={{ ...s.input, width: 64, marginRight: 0, height: 24 }}
                          />
                        </div>
                      </div>
                    )}

                    {/* GEO inputs */}
                    {pair.coordinateMode === 'geo' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: '#999' }}>LAT</div>
                          <input
                            type="text"
                            value={pair.geoLat}
                            onChange={e => {
                              const val = e.target.value
                              const newPair = { ...pair, geoLat: val }
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? newPair : p))
                              const lat = parseFloat(val)
                              const lon = parseFloat(pair.geoLon)
                              if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                                updateBingoFromLatLon(pair.id, lat, lon)
                              }
                            }}
                            placeholder="32.0853"
                            style={{ ...s.input, width: '100%', marginRight: 0, height: 24 }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: '#999' }}>LON</div>
                          <input
                            type="text"
                            value={pair.geoLon}
                            onChange={e => {
                              const val = e.target.value
                              const newPair = { ...pair, geoLon: val }
                              setBingoPairs(bingoPairs.map(p => p.id === pair.id ? newPair : p))
                              const lat = parseFloat(pair.geoLat)
                              const lon = parseFloat(val)
                              if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                                updateBingoFromLatLon(pair.id, lat, lon)
                              }
                            }}
                            placeholder="34.7818"
                            style={{ ...s.input, width: '100%', marginRight: 0, height: 24 }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Pick on map button */}
                    <button
                      onClick={() => {
                        setEditingPairId(pair.id)
                        onRequestMapClick()
                        setMinimized(true)
                      }}
                      style={{
                        ...s.button,
                        borderColor: '#22c55e',
                        backgroundColor: '#0a3a1a',
                        color: '#22c55e',
                        width: '100%',
                        marginBottom: 0,
                      }}
                    >
                      📍 PICK ON MAP
                    </button>
                  </div>
                ) : (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>Target</div>
                    <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                      {pair.targetLatLon.lat.toFixed(4)}° / {pair.targetLatLon.lon.toFixed(4)}° | {pair.targetElev}ft
                    </div>
                    <button
                      onClick={() => setBingoPairs(bingoPairs.map(p => p.id === pair.id ? { ...p, targetLatLon: null, targetElev: null, geoLat: '', geoLon: '' } : p))}
                      style={{ ...s.button, marginTop: 6, fontSize: 10 }}
                    >
                      Change
                    </button>
                  </div>
                )}

                {/* Label + delete */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <input
                    type="text"
                    style={{ ...s.input, flex: 1, marginBottom: 0, marginRight: 0, height: 24 }}
                    placeholder="Label (e.g. 'BASE A')"
                    value={pair.targetLabel}
                    onChange={e => updateBingoLabel(pair.id, e.target.value)}
                  />
                  <button
                    style={{ ...s.button, marginRight: 0, height: 24, marginBottom: 0 }}
                    onClick={() => deleteBingoPair(pair.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          {bingoPairs.length < 5 && (
            <button style={{ ...s.button, marginBottom: 12 }} onClick={addBingoPair}>
              + ADD PAIR
            </button>
          )}

          <button
            style={{
              ...s.buttonPrimary,
              ...(bingoCalcLoading || !bingoWindDone || bingoPairs.length === 0 ? s.buttonDisabled : {}),
            }}
            onClick={calculateBingo}
            disabled={bingoCalcLoading || !bingoWindDone || bingoPairs.length === 0}
          >
            {bingoCalcLoading ? 'CALCULATING...' : 'CALCULATE BINGO'}
          </button>

          {bingoResults.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.td, borderBottom: '2px solid #555', textAlign: 'left', paddingBottom: 8 }}>PAIR</th>
                    <th style={{ ...s.tdCenter, borderBottom: '2px solid #555', paddingBottom: 8 }}>DIST (NM)</th>
                    {windScenarios.map(scenario => (
                      <th key={scenario.id} colSpan={2} style={{ ...s.tdCenter, borderBottom: '2px solid #555', paddingBottom: 8 }}>
                        {getWindLabel(scenario)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th style={{ ...s.td, borderBottom: '1px solid #444' }}></th>
                    <th style={{ ...s.tdCenter, borderBottom: '1px solid #444' }}></th>
                    {windScenarios.map(scenario => (
                      <React.Fragment key={scenario.id}>
                        <th style={{ ...s.tdCenter, borderBottom: '1px solid #444', fontSize: 10, color: '#999' }}>TIME</th>
                        <th style={{ ...s.tdCenter, borderBottom: '1px solid #444', fontSize: 10, color: '#999' }}>FUEL</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bingoResults.map(result => {
                    const pair = bingoPairs.find(p => p.id === result.pairId)
                    if (!pair) return null

                    const pairLabel = getPairLabel(pair)
                    const firstCell = result.cells[0]
                    const dist = firstCell?.distance_nm ?? 0

                    return (
                      <tr key={result.pairId}>
                        <td style={s.td}>{pairLabel}</td>
                        <td style={s.tdCenter}>{dist.toFixed(1)}</td>
                        {result.cells.map(cell => {
                          const srcWptResult = windResults.find(wr => wr.scenarioId === cell.scenarioId)?.data?.waypoints[pair.sourceWptIdx]
                          const srcFuel = srcWptResult?.fuel_remaining_lbs ?? 0

                          return (
                            <React.Fragment key={cell.scenarioId}>
                              <td style={s.tdCenter}>
                                {cell.status === 'done' && cell.time_min !== null
                                  ? `${Math.floor(cell.time_min)}:${String(Math.round((cell.time_min % 1) * 60)).padStart(2, '0')}`
                                  : '–'}
                              </td>
                              <td style={cell.fuel_needed_lbs > srcFuel ? s.tdWarn : s.tdCenter}>
                                {cell.status === 'done' && cell.fuel_needed_lbs !== null ? Math.round(cell.fuel_needed_lbs) : '–'}
                              </td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
          )}
        </div>
      </div>
    </div>
  )
}
