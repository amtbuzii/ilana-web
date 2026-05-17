import React, { useState, useEffect, useCallback } from 'react'
import * as api from '../api.js'
import { useTheme } from '../theme.jsx'

export default function NotesPanel({
  routes,
  settings,
  activeRoute,
  onRequestMapClick,
  pendingBingoTarget,
  onBingoTargetConsumed,
  bingoTargetMode,
}) {
  const { t } = useTheme()
  const [selectedRouteId, setSelectedRouteId] = useState(activeRoute?.id ?? routes[0]?.id)
  const [windScenarios, setWindScenarios] = useState([])
  const [windResults, setWindResults] = useState([])
  const [calcLoading, setCalcLoading] = useState(false)
  const [bingoPairs, setBingoPairs] = useState([])
  const [bingoResults, setBingoResults] = useState([])
  const [bingoCalcLoading, setBingoCalcLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('wind') // 'config' | 'wind' | 'bingo'
  const [editingPairId, setEditingPairId] = useState(null)
  const [windIdCounter, setWindIdCounter] = useState(0)
  const [bingoIdCounter, setBingoIdCounter] = useState(0)

  const [windMode, setWindMode] = useState('HEADWIND')
  const [windDirection, setWindDirection] = useState(270)
  const [windSpeed, setWindSpeed] = useState(15)
  const [newBingoSourceIdx, setNewBingoSourceIdx] = useState(0)

  const [windExpanded, setWindExpanded] = useState(true)
  const [bingoExpanded, setBingoExpanded] = useState(true)

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
    return (toDeg(Math.atan2(y, x)) + 360) % 360
  }

  function haversineNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065
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
      wca_thresholds: { torque_pct: null, pa_pct: null, oge_flag: false, ige_flag: false },
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Map click handler
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
                  coordinateMode: 'done',
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
                  coordinateMode: 'done',
                }
              : p
          )
        )
      }
    }
    elevFetch()
    onBingoTargetConsumed()
    setEditingPairId(null)
  }, [pendingBingoTarget, editingPairId, onBingoTargetConsumed])

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
          return { scenarioId: scenario.id, status: 'error', data: null, error: err.message }
        }
      })
      const results = await Promise.all(promises)
      setWindResults(results)
      setActiveTab('wind')
    } finally {
      setCalcLoading(false)
    }
  }, [route, windScenarios])

  // ─────────────────────────────────────────────────────────────
  // Wind scenario management
  // ─────────────────────────────────────────────────────────────

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
      return `Fixed ${Math.round(scenario.direction)}°/${scenario.speed}KT`
    }
    return `${scenario.mode === 'HEADWIND' ? 'HW' : scenario.mode === 'TAILWIND' ? 'TW' : scenario.mode === 'RIGHT_CROSS' ? 'RX' : 'LX'} ${scenario.speed}KT`
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
      coordinateMode: 'map', // 'map' | 'utm' | 'geo' | 'done'
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
                coordinateMode: 'done',
              }
            : p
        )
      )
    } catch (err) {
      // silently ignore
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
                coordinateMode: 'done',
              }
            : p
        )
      )
    } catch (err) {
      // silently ignore
    }
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Styles
  // ─────────────────────────────────────────────────────────────

  const styles = {
    container: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: t.bg0,
      color: t.text0,
      fontFamily: t.font,
      fontSize: 11,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 12px',
      background: t.bg1,
      borderBottom: `1px solid ${t.border0}`,
      flexShrink: 0,
      gap: 8,
    },
    button: {
      padding: '4px 10px',
      fontSize: 10,
      border: `1px solid ${t.border0}`,
      borderRadius: 3,
      background: t.bg2,
      color: t.text0,
      cursor: 'pointer',
      fontWeight: 600,
      fontFamily: t.font,
    },
    buttonPrimary: {
      padding: '4px 10px',
      fontSize: 10,
      border: `1px solid ${t.accent}`,
      borderRadius: 3,
      background: t.accent + '22',
      color: t.accent,
      cursor: 'pointer',
      fontWeight: 600,
      fontFamily: t.font,
    },
    section: {
      padding: '8px 12px',
      borderBottom: `1px solid ${t.border0}`,
    },
    sectionTitle: {
      fontSize: 10,
      fontWeight: 700,
      color: t.text2,
      textTransform: 'uppercase',
      letterSpacing: 1,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    sectionContent: {
      marginTop: 8,
      paddingLeft: 12,
    },
    tabsContainer: {
      display: 'flex',
      gap: 0,
      borderBottom: `1px solid ${t.border0}`,
      background: t.bg1,
      padding: '0 8px',
      flexShrink: 0,
    },
    tab: {
      padding: '6px 12px',
      fontSize: 10,
      border: 'none',
      background: 'transparent',
      color: t.text2,
      cursor: 'pointer',
      fontWeight: 600,
      fontFamily: t.font,
      borderBottom: `2px solid transparent`,
    },
    tabActive: {
      color: t.accent,
      borderBottomColor: t.accent,
    },
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: t.text3, textTransform: 'uppercase', fontWeight: 700 }}>Route</span>
          <select
            value={selectedRouteId || ''}
            onChange={e => setSelectedRouteId(parseInt(e.target.value))}
            style={{
              fontSize: 10,
              padding: '2px 6px',
              border: `1px solid ${t.border0}`,
              borderRadius: 3,
              background: t.bg2,
              color: t.text0,
              fontFamily: t.font,
            }}
          >
            {routes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={styles.button}>⊞ FULL</button>
          <button style={styles.button}>⬇ EXCEL</button>
          <button style={styles.button}>⬇ PRINT</button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'config' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {/* Wind Settings */}
          <div style={styles.section}>
            <div style={styles.sectionTitle} onClick={() => setWindExpanded(!windExpanded)}>
              {windExpanded ? '▼' : '▶'} WIND SCENARIOS
            </div>
            {windExpanded && (
              <div style={styles.sectionContent}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {['HEADWIND', 'TAILWIND', 'RIGHT_CROSS', 'LEFT_CROSS', 'FIXED'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setWindMode(mode)}
                      style={{
                        ...styles.button,
                        ...(windMode === mode ? { background: t.accent + '22', borderColor: t.accent, color: t.accent } : {}),
                        fontSize: 9,
                        padding: '3px 8px',
                      }}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                {windMode === 'FIXED' && (
                  <div style={{ marginBottom: 8 }}>
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={windDirection}
                      onChange={e => setWindDirection(parseInt(e.target.value) || 0)}
                      style={{
                        fontSize: 10,
                        padding: '3px 6px',
                        border: `1px solid ${t.border0}`,
                        borderRadius: 3,
                        background: t.bg2,
                        color: t.text0,
                        fontFamily: t.font,
                        width: 60,
                      }}
                      placeholder="Dir°"
                    />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
                  <button onClick={() => setWindSpeed(Math.max(0, windSpeed - 5))} style={{ ...styles.button, padding: '3px 8px', fontSize: 9 }}>−</button>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={windSpeed}
                    onChange={e => setWindSpeed(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{
                      fontSize: 10,
                      padding: '3px 6px',
                      border: `1px solid ${t.border0}`,
                      borderRadius: 3,
                      background: t.bg2,
                      color: t.text0,
                      fontFamily: t.font,
                      width: 50,
                    }}
                    placeholder="Speed"
                  />
                  <span style={{ color: t.text2 }}>KT</span>
                  <button onClick={() => setWindSpeed(windSpeed + 5)} style={{ ...styles.button, padding: '3px 8px', fontSize: 9 }}>+</button>
                </div>
                <div>
                  {windScenarios.map(scenario => (
                    <div key={scenario.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 9 }}>
                      <span>{getWindLabel(scenario)}</span>
                      <button onClick={() => deleteWindScenario(scenario.id)} style={{ ...styles.button, padding: '2px 6px', fontSize: 8 }}>✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={addWindScenario} style={{ ...styles.buttonPrimary, width: '100%', marginTop: 8 }}>+ ADD WIND</button>
              </div>
            )}
          </div>

          {/* Bingo Settings */}
          <div style={styles.section}>
            <div style={styles.sectionTitle} onClick={() => setBingoExpanded(!bingoExpanded)}>
              {bingoExpanded ? '▼' : '▶'} BINGO PAIRS
            </div>
            {bingoExpanded && (
              <div style={styles.sectionContent}>
                {bingoPairs.map((pair, idx) => (
                  <div key={pair.id} style={{ padding: '6px', background: t.bg2, borderRadius: 3, marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                      <select
                        value={pair.sourceWptIdx}
                        onChange={e => updateBingoSource(pair.id, parseInt(e.target.value))}
                        style={{
                          fontSize: 9,
                          padding: '2px 4px',
                          border: `1px solid ${t.border0}`,
                          borderRadius: 3,
                          background: t.bg3,
                          color: t.text0,
                          fontFamily: t.font,
                          flex: 1,
                        }}
                      >
                        {route?.waypoints.map((w, i) => (
                          <option key={i} value={i}>
                            WP{i + 1}
                          </option>
                        ))}
                      </select>
                      <span style={{ color: t.text2 }}>→</span>
                      {!pair.targetLatLon ? (
                        <button
                          onClick={() => {
                            setEditingPairId(pair.id)
                            onRequestMapClick()
                          }}
                          style={{ ...styles.buttonPrimary, flex: 1, fontSize: 9 }}
                        >
                          📍 MAP
                        </button>
                      ) : (
                        <span style={{ fontSize: 9, color: t.accent, flex: 1 }}>
                          {pair.targetLatLon.lat.toFixed(3)}° / {pair.targetLatLon.lon.toFixed(3)}°
                        </span>
                      )}
                      <button onClick={() => deleteBingoPair(pair.id)} style={{ ...styles.button, padding: '2px 6px', fontSize: 8 }}>✕</button>
                    </div>
                    <input
                      type="text"
                      placeholder="Label"
                      value={pair.targetLabel}
                      onChange={e => updateBingoLabel(pair.id, e.target.value)}
                      style={{
                        fontSize: 9,
                        padding: '3px 6px',
                        border: `1px solid ${t.border0}`,
                        borderRadius: 3,
                        background: t.bg3,
                        color: t.text0,
                        fontFamily: t.font,
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}
                {bingoPairs.length < 5 && (
                  <button onClick={addBingoPair} style={{ ...styles.buttonPrimary, width: '100%' }}>+ ADD PAIR</button>
                )}
              </div>
            )}
          </div>

          {/* Calculate Button */}
          <div style={{ padding: '8px 12px' }}>
            <button
              onClick={calculateWind}
              disabled={calcLoading || windScenarios.length === 0 || !route}
              style={{
                ...styles.buttonPrimary,
                width: '100%',
                opacity: calcLoading || windScenarios.length === 0 || !route ? 0.5 : 1,
                cursor: calcLoading || windScenarios.length === 0 || !route ? 'not-allowed' : 'pointer',
              }}
            >
              {calcLoading ? 'CALCULATING...' : 'CALCULATE'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={styles.tabsContainer}>
            <button
              onClick={() => setActiveTab('config')}
              style={{ ...styles.tab, ...(activeTab === 'config' ? styles.tabActive : {}) }}
            >
              SETTINGS
            </button>
            {windResults.map(result => {
              const scenario = windScenarios.find(s => s.id === result.scenarioId)
              return (
                <button
                  key={result.scenarioId}
                  onClick={() => setActiveTab(`wind-${result.scenarioId}`)}
                  style={{
                    ...styles.tab,
                    ...(activeTab === `wind-${result.scenarioId}` ? styles.tabActive : {}),
                  }}
                >
                  {scenario ? getWindLabel(scenario) : 'Wind'}
                </button>
              )
            })}
            <button
              onClick={() => setActiveTab('bingo')}
              style={{ ...styles.tab, ...(activeTab === 'bingo' ? styles.tabActive : {}) }}
            >
              BINGO
            </button>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {activeTab === 'config' && <div>Configuration</div>}
            {activeTab.startsWith('wind-') && <div>Wind results</div>}
            {activeTab === 'bingo' && <div>Bingo results</div>}
          </div>
        </>
      )}
    </div>
  )
}
