// Root application component — multi-route AH-64D mission planner: panels, map, weight, waypoints, export.
import { useState, useEffect, useCallback, useRef } from 'react'
import MapView from './components/MapView.jsx'
import WaypointPanel from './components/WaypointPanel.jsx'
import ResultsTable from './components/ResultsTable.jsx'
import WingStoresPanel from './components/WingStoresPanel.jsx'
import RoutePanel, { ROUTE_COLORS } from './components/RoutePanel.jsx'
import WcaPanel from './components/WcaPanel.jsx'
import EasterEggGame from './components/EasterEggGame.jsx'
import UtmEntryModal from './components/UtmEntryModal.jsx'
import NotesPanel from './components/NotesPanel.jsx'
import { calculateFlightPlan, fetchElevation, utmToLatLon, cspFuelFromOge, cspFuelFromIge, suggestClimbSpeed } from './api.js'
import { exportFlightTable, exportExcel, importFromExcel, utmToLatLon as utmToLatLonJS } from './exportTable.js'
import * as XLSX from 'xlsx'
import { useTheme } from './theme.jsx'
import { useExplanations } from './useExplanations.js'

const DEFAULT_WPT = { name: '', lat: '', lon: '', alt_ft: '', surface_alt_ft: '', airspeed_kts: '120', oat_c: '25', oat_auto: true, atf: '1.0', hold_type: null, hold_min: '5', hold_speed_kts: '80', spare_pct: '0', wind_dir: '0', wind_speed_kts: '0', tot_time: '', tot_mode: 'daytime' }
const computeOat  = (alt_ft, slTemp) => {
  const alt = parseFloat(alt_ft)
  if (!alt_ft || isNaN(alt)) return String(parseFloat(slTemp) || 25)
  return String(Math.round(((parseFloat(slTemp) || 25) - (alt / 1000) * 1.98) * 10) / 10)
}

const DEFAULT_STATIONS = { l_inboard: 'eft_230', r_inboard: 'eft_230', l_outboard: 'hf_4rnd', r_outboard: 'hf_4rnd' }
const countStore       = (cfg, id) => Object.values(cfg).filter(s => s === id).length
const VARIANT_LABEL    = { LB: 'AH-64D', peten: 'AH-64A' }

const SETTINGS_DEFAULTS = {
  // Drag / ATF
  fcrDeltaF:      0.81,
  compodDeltaF:   0.337,
  // Store ΔF values (sq.ft) — TM(IS) 1-1520-251-10 fig 7-42
  dfNoWeapons:   -0.996,
  dfEftIb:        0.205,  dfEftOb:   0.170,
  dfHfIb:         0.364,  dfHfOb:    0.293,
  dfEoIb:         0.364,  dfEoOb:    0.293,
  dfRktIb:        0.071,  dfRktOb:   0.071,
  // Equipment weights (lbs)
  fcrWeight:      400,
  compodWeight:   96,
  // Crew / misc weights
  crewWtDefault:  400,
  chaffFlareWtDefault: 150,
  // Armament weights
  hellfireWt:     110,   // per missile
  eoMissileWt:    160,   // per missile
  rocketRoundWt:  36,    // per round
  gunRoundWt:     0.77,  // per round (lbs)
  // Store hardware weights (pylon/launcher)
  hwEft230:       139,
  hwHf4rnd:       139,
  hwEoLauncher:   162,
  hwRocketM261:   143,   // Rocket "Pigeon" launcher
  // WCA — all three levels independently configurable
  wcaWarningsEnabled:       true,
  wcaWarnDeltaTorque:       5.0,
  wcaWarnCruiseTorque:     100.0,
  wcaWarnMinFuel:           350,
  wcaWarnMaxGw:             22500,
  wcaCautionsEnabled:              true,
  wcaCautionDeltaTorqueEnabled:    true,
  wcaCautionDeltaTorque:           10.0,
  wcaCautionCruiseTorqueEnabled:   true,
  wcaCautionCruiseTorque:          96.0,
  wcaCautionTerrainEnabled:        true,
  wcaCautionTerrainMargin:         100,
  wcaAdvisoriesEnabled:            false,
  wcaAdvisoryDeltaTorqueEnabled:   false,
  wcaAdvisoryDeltaTorque:          15.0,
  wcaAdvisoryCruiseTorqueEnabled:  false,
  wcaAdvisoryCruiseTorque:         92.0,
  wcaAdvisoryFuelEnabled:          false,
  wcaAdvisoryMinFuel:              550,
  // Joker fuel — minimum fuel reserve for mission planning
  jokerFuel:                       350,
}

const ROUTE_CONFIG_DEFAULTS = {
  variant:         'LB',
  baseEmptyWt:     '13200',
  otherWt:         '0',
  initFuel:        '2500',
  fcrOn:           false,
  compodOn:        false,
  globalAtf:       1.0,
  etfEng1:         '0.95',
  etfEng2:         '0.95',
  gunAmmo:         '500',
  stationsConfig:  DEFAULT_STATIONS,
  hfMissiles:      countStore(DEFAULT_STATIONS, 'hf_4rnd')    * 3,
  eoMissiles:      countStore(DEFAULT_STATIONS, 'eo_launcher') * 2,
  rocketRounds:    countStore(DEFAULT_STATIONS, 'rocket_m261') * 4,
  aglOffset:       '1000',
  altMode:         'AGL',
  seaLevelTemp:    '25',
  windPreset:      'fixed',
  windPresetDir:   '270',
  windPresetSpeed: '20',
  cspWptIdx:       null,
  cspFuel:         '',
}

const STORAGE_KEY = 'raner_x_v3'
const loadSaved = () => { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {} } catch { return {} } }

function SideBtn({ icon, label, tip, onClick, t, warn = false, accent = false }) {
  const baseColor  = warn ? t.warn : accent ? t.accent : t.text2
  const baseBorder = warn ? t.warn : accent ? t.border1 : t.border0
  return (
    <button onClick={onClick} title={tip} style={{
      width: 46, height: 46, background: 'none',
      border: `1px solid ${baseBorder}`,
      borderRadius: 6, cursor: 'pointer', color: baseColor,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 2, fontFamily: t.font, transition: 'all 0.12s', flexShrink: 0,
    }}
    onMouseEnter={e => { e.currentTarget.style.background = t.bg2; e.currentTarget.style.color = warn ? t.warn : t.accent; e.currentTarget.style.borderColor = warn ? t.warn : t.accent }}
    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = baseColor; e.currentTarget.style.borderColor = baseBorder }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 8, letterSpacing: 0.5, fontWeight: 700 }}>{label}</span>
    </button>
  )
}

function SideSep({ t }) {
  return <div style={{ width: 36, height: 1, background: t.border0, margin: '3px 0', flexShrink: 0 }} />
}

export default function App() {
  const { t, themeName, toggle } = useTheme()
  const { get } = useExplanations()
  const s0 = loadSaved()

  const [projectName, setProjectName]  = useState(s0.projectName    ?? 'Ilana')

  // ── Multi-route state ──────────────────────────────────────────────────────
  const initRoutes = s0.routes
    ? s0.routes.map((r, i) => ({
        ...r,
        id: r.id ?? i,
        color: r.color ?? ROUTE_COLORS[i % ROUTE_COLORS.length],
        visible: r.visible ?? true,
        config: { ...ROUTE_CONFIG_DEFAULTS, ...(r.config ?? {}) },
        waypoints: (r.waypoints ?? []).map(wp => ({ ...DEFAULT_WPT, ...wp, oat_auto: wp.oat_auto ?? true })),
        results: null,
      }))
    : [{
        id: 0, name: 'Route 1', visible: true, color: ROUTE_COLORS[0],
        config: {
          ...ROUTE_CONFIG_DEFAULTS,
          variant:        s0.variant        ?? ROUTE_CONFIG_DEFAULTS.variant,
          baseEmptyWt:    s0.baseEmptyWt    ?? ROUTE_CONFIG_DEFAULTS.baseEmptyWt,
          otherWt:        s0.otherWt        ?? ROUTE_CONFIG_DEFAULTS.otherWt,
          initFuel:       s0.initFuel       ?? ROUTE_CONFIG_DEFAULTS.initFuel,
          etfEng1:        s0.etfEng1        ?? ROUTE_CONFIG_DEFAULTS.etfEng1,
          etfEng2:        s0.etfEng2        ?? ROUTE_CONFIG_DEFAULTS.etfEng2,
          gunAmmo:        s0.gunAmmo        ?? ROUTE_CONFIG_DEFAULTS.gunAmmo,
          stationsConfig: s0.stationsConfig ?? ROUTE_CONFIG_DEFAULTS.stationsConfig,
          hfMissiles:     s0.hfMissiles     ?? ROUTE_CONFIG_DEFAULTS.hfMissiles,
          eoMissiles:     s0.eoMissiles     ?? ROUTE_CONFIG_DEFAULTS.eoMissiles,
          rocketRounds:   s0.rocketRounds   ?? ROUTE_CONFIG_DEFAULTS.rocketRounds,
          aglOffset:      s0.aglOffset      ?? ROUTE_CONFIG_DEFAULTS.aglOffset,
          altMode:        s0.altMode        ?? ROUTE_CONFIG_DEFAULTS.altMode,
          seaLevelTemp:   s0.seaLevelTemp   ?? ROUTE_CONFIG_DEFAULTS.seaLevelTemp,
        },
        waypoints: s0.waypoints ?? [],
        results: null,
      }]
  const [routes, setRoutes]         = useState(initRoutes)
  const [activeRouteId, setActiveRouteId] = useState(s0.activeRouteId ?? initRoutes[0].id)
  const [rightFolded, setRightFolded] = useState(false)
  const [rightWidth,  setRightWidth]  = useState(230)
  const routeIdRef = useRef(Math.max(...initRoutes.map(r => r.id)) + 1)

  // Derived: active route + its waypoints/results
  const activeRoute  = routes.find(r => r.id === activeRouteId) ?? routes[0]
  const waypoints    = activeRoute.waypoints
  const results      = activeRoute.results

  const updateRoute  = (id, fn) => setRoutes(rs => rs.map(r => r.id === id ? fn(r) : r))
  const setWaypoints = fn => updateRoute(activeRouteId, r => ({ ...r, waypoints: typeof fn === 'function' ? fn(r.waypoints) : fn }))
  const setResults   = res => updateRoute(activeRouteId, r => ({ ...r, results: typeof res === 'function' ? res(r.results) : res }))

  // ── Per-route config ───────────────────────────────────────────────────────
  const cfg = activeRoute.config ?? ROUTE_CONFIG_DEFAULTS
  const { variant, baseEmptyWt, otherWt, initFuel, fcrOn, compodOn, globalAtf,
          etfEng1, etfEng2, gunAmmo, stationsConfig,
          hfMissiles, eoMissiles, rocketRounds,
          aglOffset, altMode, seaLevelTemp,
          windPreset, windPresetDir, windPresetSpeed } = cfg

  const setRC = (field, value) =>
    updateRoute(activeRouteId, r => ({ ...r, config: { ...r.config, [field]: value } }))

  const setVariant         = v => setRC('variant', v)
  const setBaseEmptyWt     = v => setRC('baseEmptyWt', v)
  const setOtherWt         = v => setRC('otherWt', v)
  const setInitFuel        = v => setRC('initFuel', v)
  const setFcrOn           = v => setRC('fcrOn', v)
  const setCompodOn        = v => setRC('compodOn', v)
  const setGlobalAtf       = v => setRC('globalAtf', v)
  const setEtfEng1         = v => setRC('etfEng1', v)
  const setEtfEng2         = v => setRC('etfEng2', v)
  const setGunAmmo         = v => setRC('gunAmmo', v)
  const setStationsConfig  = v => setRC('stationsConfig', v)
  const setHfMissiles      = v => setRC('hfMissiles',   typeof v === 'function' ? v(cfg.hfMissiles)   : v)
  const setEoMissiles      = v => setRC('eoMissiles',   typeof v === 'function' ? v(cfg.eoMissiles)   : v)
  const setRocketRounds    = v => setRC('rocketRounds', typeof v === 'function' ? v(cfg.rocketRounds) : v)
  const setAglOffset       = v => setRC('aglOffset', v)
  const setAltMode         = v => setRC('altMode', v)
  const setSeaLevelTemp    = v => setRC('seaLevelTemp', v)
  const setWindPreset      = v => setRC('windPreset', v)
  const setWindPresetDir   = v => setRC('windPresetDir', v)
  const setWindPresetSpeed = v => setRC('windPresetSpeed', v)
  const setCspWptIdx       = v => setRC('cspWptIdx', v)
  const setCspFuel         = v => setRC('cspFuel', v)

  const [error, setError]         = useState(null)
  const [loading, setLoading]     = useState(false)
  const [activeWpt,    setActiveWpt]    = useState(null)
  const [targetWptIdx, setTargetWptIdx] = useState(null)
  const [selectedWpt,  setSelectedWpt]  = useState(null)
  const [selectedLeg,  setSelectedLeg]  = useState(null)
  const [selectedWpts, setSelectedWpts] = useState(new Set())
  const [undoStack, setUndoStack] = useState([])

  // ── Wind preset (UI toggle only) ───────────────────────────────────────────
  const [windExpanded,    setWindExpanded]    = useState(false)

  // Section expand states
  const [acftExpanded,   setAcftExpanded]   = useState(false)
  const [weightExpanded, setWeightExpanded] = useState(false)
  const [navExpanded,    setNavExpanded]    = useState(false)
  const [wptExpanded,    setWptExpanded]    = useState(true)
  const [wtBkExpanded,   setWtBkExpanded]   = useState(false)

  // ── Layout resize / fold ──────────────────────────────────────────────────
  const [leftWidth,   setLeftWidth]   = useState(400)
  const [leftFolded,  setLeftFolded]  = useState(false)
  const [tableHeight, setTableHeight] = useState(280)
  const [tableFolded,     setTableFolded]     = useState(false)
  const [tableFullscreen, setTableFullscreen] = useState(false)
  const [mapOpacity,      setMapOpacity]      = useState(100)
  const [showAbout,      setShowAbout]      = useState(false)
  const [showEasterEgg,  setShowEasterEgg]  = useState(false)
  const logoClickRef = useRef({ count: 0, timer: null })
  const [dataStatus,     setDataStatus]     = useState(null)
  const [tileMode,       setTileMode]       = useState(() => localStorage.getItem('tileMode') || 'offline')
  const [showHelp,       setShowHelp]       = useState(false)
  const [helpTopic,      setHelpTopic]      = useState(null)  // null | 'maps' | 'dsm'
  const [showNewConfirm,  setShowNewConfirm]  = useState(false)
  const [showLoadConfirm, setShowLoadConfirm] = useState(null)  // null | 'json' | 'xls'
  const [pendingMapMove,  setPendingMapMove]  = useState(null)  // null | { lat, lon, wptIdx }
  const [showSettings,   setShowSettings]   = useState(false)
  const [showWca,        setShowWca]        = useState(false)
  const [wcaTab,         setWcaTab]         = useState('WARNING')
  const [pendingWca,     setPendingWca]     = useState(SETTINGS_DEFAULTS)
  const [showExportModal, setShowExportModal] = useState(null) // 'excel' | 'print' | null
  const [exportRouteIds,  setExportRouteIds]  = useState(new Set())
  const [settings,       setSettings]     = useState(SETTINGS_DEFAULTS)
  const [pendingSet,     setPendingSet]   = useState(SETTINGS_DEFAULTS)
  const [confirmStep,    setConfirmStep]  = useState(0) // 0=edit 1=confirm1 2=confirm2
  const [stopAlert,    setStopAlert]    = useState(null)  // null | StopAlert — mid-leg halt position
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestResult,  setSuggestResult]  = useState(null)  // null | { found, suggested_tas_kts, original_tas_kts, message, wptIdx }
  const [showUtmModal,    setShowUtmModal]    = useState(false)
  const [showNotes,          setShowNotes]          = useState(false)
  const [bingoTargetMode,    setBingoTargetMode]    = useState(false)
  const [pendingBingoTarget, setPendingBingoTarget] = useState(null)
  const [fileImportError,  setFileImportError]  = useState(null)
  const [fileImportStatus, setFileImportStatus] = useState(null)   // null | string
  const fileImportRef = useRef(null)
  const entImportRef  = useRef(null)
  const [mapAddMode,   setMapAddMode]   = useState(false)
  const [settingsTab,    setSettingsTab]  = useState('drag')
  const [settingsReset,  setSettingsReset] = useState(0) // increment to force input remount
  const leftDragRef  = useRef(null)
  const tableDragRef = useRef(null)
  const rightDragRef = useRef(null)

  useEffect(() => {
    const onMove = e => {
      if (leftDragRef.current) {
        const delta = e.clientX - leftDragRef.current.startX
        setLeftWidth(Math.max(280, Math.min(720, leftDragRef.current.startWidth + delta)))
      }
      if (tableDragRef.current) {
        const delta = tableDragRef.current.startY - e.clientY   // drag up = taller
        setTableHeight(Math.max(80, Math.min(window.innerHeight * 0.82, tableDragRef.current.startHeight + delta)))
      }
      if (rightDragRef.current) {
        const delta = rightDragRef.current.startX - e.clientX   // drag left = wider
        setRightWidth(Math.max(180, Math.min(480, rightDragRef.current.startWidth + delta)))
      }
    }
    const onUp = () => { leftDragRef.current = null; tableDragRef.current = null; rightDragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',  onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Fetch data status once on mount ──────────────────────────────────────
  useEffect(() => {
    fetch('http://localhost:8000/api/data-status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDataStatus(d) })
      .catch(() => {})
  }, [])

  const importRef       = useRef(null)
  const importXlsRef    = useRef(null)
  const seaLevelTempRef = useRef(seaLevelTemp)
  useEffect(() => { seaLevelTempRef.current = seaLevelTemp }, [seaLevelTemp])

  // ── Persist state to localStorage ─────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      projectName,
      routes: routes.map(r => ({ ...r, results: null })),
      activeRouteId,
      settings,
    }))
  }, [projectName, routes, activeRouteId, settings])

  const acft = (((parseFloat(etfEng1) || 1) + (parseFloat(etfEng2) || 1)) / 2).toFixed(3)

  // ── Launcher counts ────────────────────────────────────────────────────────
  const hfCount  = countStore(stationsConfig, 'hf_4rnd')
  const eoCount  = countStore(stationsConfig, 'eo_launcher')
  const rktCount = countStore(stationsConfig, 'rocket_m261')
  const eftCount = countStore(stationsConfig, 'eft_230')
  const maxFuel  = 2500 + (eftCount * 1500)  // 2500 internal + 1500 per EFT

  const prevCountsRef = useRef({})

  // Seed prevCounts when switching routes so next stationsConfig change computes correct delta
  useEffect(() => {
    prevCountsRef.current[activeRouteId] = {
      hf:  countStore(cfg.stationsConfig, 'hf_4rnd'),
      eo:  countStore(cfg.stationsConfig, 'eo_launcher'),
      rkt: countStore(cfg.stationsConfig, 'rocket_m261'),
    }
  }, [activeRouteId])   // eslint-disable-line

  useEffect(() => {
    const id = activeRouteId
    const prev = prevCountsRef.current[id] ?? {
      hf:  countStore(cfg.stationsConfig, 'hf_4rnd'),
      eo:  countStore(cfg.stationsConfig, 'eo_launcher'),
      rkt: countStore(cfg.stationsConfig, 'rocket_m261'),
    }
    const hf  = countStore(cfg.stationsConfig, 'hf_4rnd')
    const eo  = countStore(cfg.stationsConfig, 'eo_launcher')
    const rkt = countStore(cfg.stationsConfig, 'rocket_m261')

    const dHf  = hf  - prev.hf
    const dEo  = eo  - prev.eo
    const dRkt = rkt - prev.rkt

    prevCountsRef.current[id] = { hf, eo, rkt }

    if (dHf  !== 0) setRC('hfMissiles',   Math.max(0, (parseInt(cfg.hfMissiles)   || 0) + dHf  * 3))
    if (dEo  !== 0) setRC('eoMissiles',   Math.max(0, (parseInt(cfg.eoMissiles)   || 0) + dEo  * 2))
    if (dRkt !== 0) setRC('rocketRounds', Math.max(0, (parseInt(cfg.rocketRounds) || 0) + dRkt * 4))
  }, [cfg.stationsConfig])   // eslint-disable-line

  // Recompute auto-OAT when sea level temp changes
  useEffect(() => {
    const slTemp = seaLevelTempRef.current
    setWaypoints(wps => wps.map(wp =>
      wp.oat_auto ? { ...wp, oat_c: computeOat(wp.alt_ft, slTemp) } : wp
    ))
  }, [seaLevelTemp])   // eslint-disable-line


  // ── Weight computation ─────────────────────────────────────────────────────
  const HW_WEIGHTS      = { eft_230: settings.hwEft230, hf_4rnd: settings.hwHf4rnd, eo_launcher: settings.hwEoLauncher, rocket_m261: settings.hwRocketM261 }

  // Compute export props from any route's config (used by modal to avoid using active-route config)
  const routeExportProps = (r) => {
    const rc = r.config ?? ROUTE_CONFIG_DEFAULTS
    const rStoresHwWt = Object.values(rc.stationsConfig ?? {}).reduce((s, id) => s + (HW_WEIGHTS[id] || 0), 0)
    const rGunAmmoWt  = Math.round((parseFloat(rc.gunAmmo) || 0) * settings.gunRoundWt)
    const rMissilesWt = (parseInt(rc.hfMissiles) || 0) * settings.hellfireWt + (parseInt(rc.eoMissiles) || 0) * settings.eoMissileWt + (parseInt(rc.rocketRounds) || 0) * settings.rocketRoundWt
    const rFcrWt      = rc.fcrOn ? settings.fcrWeight : 0
    const rCompodWt   = rc.compodOn ? settings.compodWeight : 0
    const rEmptyWt    = Math.round((parseFloat(rc.baseEmptyWt) || 13200) + settings.crewWtDefault + (parseFloat(rc.otherWt) || 0) + settings.chaffFlareWtDefault + rStoresHwWt + rGunAmmoWt + rMissilesWt + rFcrWt + rCompodWt)
    return {
      variant: rc.variant, initFuel: rc.initFuel, emptyWt: rEmptyWt,
      baseEmptyWt: rc.baseEmptyWt, otherWt: rc.otherWt,
      etfEng1: rc.etfEng1, etfEng2: rc.etfEng2, globalAtf: rc.globalAtf,
      gunAmmo: rc.gunAmmo, hfMissiles: rc.hfMissiles, eoMissiles: rc.eoMissiles, rocketRounds: rc.rocketRounds,
      stationsConfig: rc.stationsConfig,
      storesHwWt: rStoresHwWt, gunAmmoWt: rGunAmmoWt, missilesWt: rMissilesWt,
      crewWt: settings.crewWtDefault,
    }
  }
  const storesHwWt      = Object.values(stationsConfig).reduce((s, id) => s + (HW_WEIGHTS[id] || 0), 0)
  const gunAmmoWt       = Math.round((parseFloat(gunAmmo) || 0) * settings.gunRoundWt)
  const missilesWt      = (parseInt(hfMissiles) || 0) * settings.hellfireWt + (parseInt(eoMissiles) || 0) * settings.eoMissileWt + (parseInt(rocketRounds) || 0) * settings.rocketRoundWt
  const fcrWt           = fcrOn ? settings.fcrWeight : 0
  const compodWt        = compodOn ? settings.compodWeight : 0
  const configuredEmptyWt = Math.round(
    (parseFloat(baseEmptyWt) || 13200) + settings.crewWtDefault + (parseFloat(otherWt) || 0) + settings.chaffFlareWtDefault + storesHwWt + gunAmmoWt + missilesWt + fcrWt + compodWt
  )
  const grossWt    = configuredEmptyWt + (parseFloat(initFuel) || 0)
  const gwColor    = grossWt > 21000 ? t.warn : t.accent

  // ── File save helper with folder picker (File System Access API) ──────────
  const saveFileWithDialog = async (blob, filename, mimeType) => {
    // Try modern File System Access API (Chrome, Edge, Brave)
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'File', accept: { [mimeType]: [filename.split('.').pop() === 'json' ? '.json' : '.xlsx'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return
      } catch (err) {
        if (err.name === 'AbortError') return  // User cancelled
        console.error('Save dialog error:', err)
        // Fall through to legacy method
      }
    }

    // Fallback: download to Downloads folder (all browsers)
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: filename }).click()
    URL.revokeObjectURL(url)
  }

  // ── Mission export / import ────────────────────────────────────────────────
  const exportMission = async () => {
    const mission = {
      project_name: projectName,
      routes: routes.map(r => ({
        id: r.id, name: r.name, color: r.color, visible: r.visible,
        config: r.config,
        waypoints: r.waypoints.map(wp => ({
          ...wp,
          hold_min:       wp.hold_type ? wp.hold_min       : null,
          hold_speed_kts: wp.hold_type ? wp.hold_speed_kts : null,
        })),
      })),
      // Legacy single-route field for backward compat
      waypoints: activeRoute.waypoints.map(wp => ({
        ...wp,
        hold_min:       wp.hold_type ? wp.hold_min       : null,
        hold_speed_kts: wp.hold_type ? wp.hold_speed_kts : null,
      })),
    }
    const safeName = projectName.trim().replace(/[^a-zA-Z0-9_\-\u0020\u0021-\u007E]/g, '_') || 'mission'
    const blob = new Blob([JSON.stringify(mission, null, 2)], { type: 'application/json' })
    await saveFileWithDialog(blob, `${safeName}.json`, 'application/json')
  }

  const importMission = (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const m = JSON.parse(ev.target.result)
        if (m.project_name) setProjectName(m.project_name)

        // Load routes (new format: config on each route) or single waypoints (old format)
        if (m.routes && Array.isArray(m.routes) && m.routes.length > 0) {
          let nextId = 0
          const loadedRoutes = m.routes.map((r, i) => ({
            ...r, id: nextId++, results: null,
            color: r.color ?? ROUTE_COLORS[i % ROUTE_COLORS.length],
            visible: r.visible ?? true,
            config: { ...ROUTE_CONFIG_DEFAULTS, ...(r.config ?? {}) },
            waypoints: (r.waypoints ?? []).map(wp => ({ ...DEFAULT_WPT, ...wp, oat_auto: wp.oat_auto ?? true })),
          }))
          routeIdRef.current = nextId
          setRoutes(loadedRoutes)
          setActiveRouteId(loadedRoutes[0].id)
        } else if (Array.isArray(m.waypoints) && m.waypoints.length > 0) {
          // Old format: single route, config at top level
          const legacyConfig = {
            ...ROUTE_CONFIG_DEFAULTS,
            variant:        m.variant          ?? ROUTE_CONFIG_DEFAULTS.variant,
            baseEmptyWt:    m.base_empty_wt    != null ? String(m.base_empty_wt)    : ROUTE_CONFIG_DEFAULTS.baseEmptyWt,
            otherWt:        m.other_wt         != null ? String(m.other_wt)         : ROUTE_CONFIG_DEFAULTS.otherWt,
            initFuel:       m.initial_fuel_lbs != null ? String(m.initial_fuel_lbs) : ROUTE_CONFIG_DEFAULTS.initFuel,
            etfEng1:        m.etf_eng1         != null ? String(m.etf_eng1)         : ROUTE_CONFIG_DEFAULTS.etfEng1,
            etfEng2:        m.etf_eng2         != null ? String(m.etf_eng2)         : ROUTE_CONFIG_DEFAULTS.etfEng2,
            gunAmmo:        m.gun_ammo         != null ? String(m.gun_ammo)         : ROUTE_CONFIG_DEFAULTS.gunAmmo,
            hfMissiles:     m.hf_missiles      ?? ROUTE_CONFIG_DEFAULTS.hfMissiles,
            eoMissiles:     m.eo_missiles      ?? ROUTE_CONFIG_DEFAULTS.eoMissiles,
            rocketRounds:   m.rocket_rounds    ?? ROUTE_CONFIG_DEFAULTS.rocketRounds,
            stationsConfig: m.stationsConfig   ?? ROUTE_CONFIG_DEFAULTS.stationsConfig,
          }
          const wpts = m.waypoints.map(wp => ({ ...DEFAULT_WPT, ...wp, oat_auto: wp.oat_auto ?? true }))
          routeIdRef.current = 1
          setRoutes([{ id: 0, name: m.project_name || 'Route 1', visible: true, color: ROUTE_COLORS[0], config: legacyConfig, waypoints: wpts, results: null }])
          setActiveRouteId(0)
        }
        setError(null); setActiveWpt(null); setTargetWptIdx(null)
      } catch { setError('Could not load mission file — file may be corrupted or not a valid Ilana save (.json)') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const importMissionXls = async (e) => {
    const file = e.target.files[0]; if (!file) return
    e.target.value = ''
    try {
      const { mission: m, waypoints: wpts } = await importFromExcel(file)
      if (m.project_name)      setProjectName(m.project_name)
      if (m.route_name)        renameRoute(activeRouteId, m.route_name)
      if (m.variant)           setVariant(m.variant)
      if (m.base_empty_wt)     setBaseEmptyWt(String(m.base_empty_wt))
      if (m.other_wt != null)  setOtherWt(String(m.other_wt))
      if (m.initial_fuel_lbs)  setInitFuel(String(m.initial_fuel_lbs))
      if (m.etf_eng1)          setEtfEng1(String(m.etf_eng1))
      if (m.etf_eng2)          setEtfEng2(String(m.etf_eng2))
      if (m.gun_ammo)          setGunAmmo(String(m.gun_ammo))
      if (m.hf_missiles  != null) setHfMissiles(m.hf_missiles)
      if (m.eo_missiles  != null) setEoMissiles(m.eo_missiles)
      if (m.rocket_rounds != null) setRocketRounds(m.rocket_rounds)
      if (m.stationsConfig)    setStationsConfig(m.stationsConfig)
      if (wpts.length > 0)     setWaypoints(wpts.map(wp => ({ ...DEFAULT_WPT, ...wp })))
      setResults(null); setStopAlert(null); setSuggestResult(null); setError(null)
    } catch (err) {
      setError(`Could not read Excel file — make sure it's a valid Galaxy export (.xlsx/.xls): ${err.message}`)
    }
  }

  const handleNewMission = () => {
    setProjectName('Ilana')
    routeIdRef.current = 1
    setRoutes([{
      id: 0, name: 'Route 1', visible: true, color: ROUTE_COLORS[0],
      config: { ...ROUTE_CONFIG_DEFAULTS },
      waypoints: [],
      results: null,
    }])
    setActiveRouteId(0)
    setError(null); setStopAlert(null)
    setActiveWpt(null); setTargetWptIdx(null)
    setSelectedWpt(null); setSelectedLeg(null)
    setShowNewConfirm(false)
  }

  const applyAglToAll = async () => {
    const offset   = parseInt(aglOffset) || 1000
    const slTemp   = seaLevelTemp          // capture before any async work
    const mode     = altMode
    const snapshot = waypoints
    // Mark waypoints with coords as loading
    setWaypoints(w => w.map(wp =>
      wp.lat && wp.lon ? { ...wp, alt_ft: '…' } : wp
    ))
    const updated = await Promise.all(snapshot.map(async wp => {
      let surf = parseFloat(wp.surface_alt_ft) || 0
      const lat = parseFloat(wp.lat)
      const lon = parseFloat(wp.lon)
      if (wp.lat && wp.lon && !isNaN(lat) && !isNaN(lon)) {
        try {
          const { elevation_ft } = await fetchElevation(lat, lon)
          surf = elevation_ft
        } catch {}
      }
      const newAlt = mode === 'MSL' ? String(offset) : String(surf + offset)
      // UPDATE ALL always resyncs OAT from ELR and marks waypoint as auto
      return {
        ...wp,
        surface_alt_ft: surf ? String(surf) : wp.surface_alt_ft,
        alt_ft: newAlt,
        oat_c: computeOat(newAlt, slTemp),
        oat_auto: true,
      }
    }))
    setWaypoints(updated)
  }

  // ── Wind preset helpers ────────────────────────────────────────────────────
  const _legBearing = (lat1, lon1, lat2, lon2) => {
    const toR = x => x * Math.PI / 180
    const lat1r = toR(lat1), lat2r = toR(lat2), dlon = toR(lon2 - lon1)
    const x = Math.sin(dlon) * Math.cos(lat2r)
    const y = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dlon)
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360
  }

  const applyWindPreset = () => {
    const speed = Math.max(0, parseFloat(windPresetSpeed) || 0)
    setWaypoints(wps => wps.map((wp, i) => {
      // Compute outbound bearing for this waypoint
      let bearing = null
      if (i < wps.length - 1) {
        const lat1 = parseFloat(wps[i].lat),   lon1 = parseFloat(wps[i].lon)
        const lat2 = parseFloat(wps[i+1].lat), lon2 = parseFloat(wps[i+1].lon)
        if (!isNaN(lat1) && !isNaN(lat2)) bearing = _legBearing(lat1, lon1, lat2, lon2)
      } else if (wps.length >= 2) {
        // Last waypoint: use inbound leg bearing
        const lat1 = parseFloat(wps[i-1].lat), lon1 = parseFloat(wps[i-1].lon)
        const lat2 = parseFloat(wps[i].lat),   lon2 = parseFloat(wps[i].lon)
        if (!isNaN(lat1) && !isNaN(lat2)) bearing = _legBearing(lat1, lon1, lat2, lon2)
      }

      let windDir
      if (windPreset === 'fixed') {
        windDir = ((parseInt(windPresetDir) || 0) + 360) % 360
      } else if (bearing !== null) {
        // All auto modes use FROM direction (standard met convention):
        // nose → wind FROM the direction you're flying = bearing
        // back → wind FROM behind = bearing + 180
        // right → wind FROM the right side = bearing + 90
        // left  → wind FROM the left side  = bearing + 270
        const offset = { nose: 0, back: 180, right: 90, left: 270 }[windPreset] ?? 0
        windDir = Math.round((bearing + offset) % 360)
      } else {
        windDir = 0
      }

      return { ...wp, wind_dir: String(windDir), wind_speed_kts: String(speed) }
    }))
  }

  // ── CSP helpers ───────────────────────────────────────────────────────────
  const { cspWptIdx, cspFuel } = cfg

  const handleSetCsp = (idx) => {
    if (cspWptIdx === idx) {
      setCspWptIdx(null); setCspFuel('')
    } else {
      setCspWptIdx(idx); setCspFuel('')
    }
  }

  const handleCspAutoOge = async (targetOge) => {
    if (cspWptIdx === null) return
    const w = waypoints[cspWptIdx]
    if (!w.alt_ft || !w.oat_c || !targetOge) return
    try {
      const nBidons = countStore(stationsConfig, 'eft_230')
      const { fuel_lbs } = await cspFuelFromOge(
        variant, parseFloat(w.alt_ft), parseFloat(w.oat_c),
        configuredEmptyWt, parseFloat(targetOge), nBidons
      )
      setCspFuel(String(fuel_lbs))
    } catch (e) { setError(`Hover power lookup failed (OGE) — ${e.message}`) }
  }

  const handleCspAutoIge = async (targetIge) => {
    if (cspWptIdx === null) return
    const w = waypoints[cspWptIdx]
    if (!w.alt_ft || !w.oat_c || !targetIge) return
    try {
      const nBidons = countStore(stationsConfig, 'eft_230')
      const { fuel_lbs } = await cspFuelFromIge(
        variant, parseFloat(w.alt_ft), parseFloat(w.oat_c),
        configuredEmptyWt, parseFloat(targetIge), nBidons
      )
      setCspFuel(String(fuel_lbs))
    } catch (e) { setError(`Hover power lookup failed (IGE) — ${e.message}`) }
  }

  // ── Undo/Redo system for waypoint and route actions ──────────────────────
  const saveToUndoStack = () => {
    setUndoStack(stack => {
      const newStack = [...stack, { routes }]
      return newStack.slice(-10)
    })
  }

  const performUndo = () => {
    if (undoStack.length === 0) return
    setUndoStack(stack => {
      const newStack = [...stack]
      const previousState = newStack.pop()
      setRoutes(previousState.routes)
      return newStack
    })
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        performUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undoStack])

  const addWaypoint = () => {
    saveToUndoStack()
    setWaypoints(w => {
      const last = w[w.length - 1]
      const base = last
        ? { ...last, lat: '', lon: '', surface_alt_ft: '', name: `WP${w.length + 1}` }
        : { ...DEFAULT_WPT, name: `WP${w.length + 1}` }
      return [...w, base]
    })
    setActiveWpt(waypoints.length)
  }

  // ── Import waypoints from XLS file (column E = "נ.צ.", format (36)710350\(N3)270275) ──
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setFileImportError(null)
    setFileImportStatus(`📂 Reading "${file.name}"…`)
    try {
      // 1 — Parse spreadsheet
      const data = await file.arrayBuffer()
      const wb   = XLSX.read(data, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // Find header row containing "נ.צ." in column E (index 4)
      let dataStart = 0
      for (let i = 0; i < Math.min(rows.length, 30); i++) {
        if (String(rows[i][4] || '').trim() === 'נ.צ.') { dataStart = i + 1; break }
      }

      // Parse each coordinate — separator may be \ or /
      const COORD_RE = /\((\d+)\)(\d+)[\\\/]\(([A-Za-z])(\d+)\)(\d+)/
      const entries = []
      for (let i = dataStart; i < rows.length; i++) {
        const m = COORD_RE.exec(String(rows[i][4] || ''))
        if (!m) continue
        const zone     = parseInt(m[1])
        const easting  = parseInt(m[2])
        const northing = parseInt(m[4] + m[5])
        const colD = String(rows[i][3] || '').trim()
        const colB = String(rows[i][1] || '').trim()
        const name = colD || (colB && !isNaN(colB) ? `WP${colB}` : colB) || `WP${entries.length + 1}`
        entries.push({ zone, easting, northing, name })
      }

      if (entries.length === 0) {
        setFileImportStatus(null)
        setFileImportError('No UTM coordinates found — make sure this is a Galaxy planning file with coordinates in column E')
        return
      }

      // 2 — Convert UTM → lat/lon synchronously (pure JS, no API call)
      setFileImportStatus(`🔄 Converting ${entries.length} coordinates…`)
      const coords = entries.map(({ zone, easting, northing }) => {
        const { lat, lon } = utmToLatLonJS(zone, 'N', easting, northing)
        return { lat, lon }
      })

      // 3 — Fetch elevations in parallel
      setFileImportStatus(`🛰 Fetching elevations (${entries.length} points)…`)
      const elevations = await Promise.all(
        coords.map(({ lat, lon }) => fetchElevation(lat, lon).catch(() => ({ elevation_ft: 0 })))
      )

      // 4 — Build waypoints
      const offset = parseInt(aglOffset) || 1000
      const wpts = coords.map(({ lat, lon }, i) => {
        const elev   = elevations[i]?.elevation_ft ?? 0
        const newAlt = altMode === 'MSL' ? String(offset) : String(Math.round(elev + offset))
        return {
          ...DEFAULT_WPT,
          name:           entries[i].name,
          lat:            String(lat),
          lon:            String(lon),
          surface_alt_ft: String(Math.round(elev)),
          alt_ft:         newAlt,
          oat_c:          computeOat(newAlt, seaLevelTemp),
          oat_auto:       true,
        }
      })

      updateRoute(activeRouteId, r => ({ ...r, waypoints: wpts, results: null }))
      setFileImportStatus(`✔ Loaded ${wpts.length} waypoints from "${file.name}"`)
    } catch (err) {
      setFileImportStatus(null)
      setFileImportError('Could not read Galaxy file — ' + err.message)
    }
  }

  // ---------- .ent file import (Einat app format) ----------
  // Screen (x,y) in nautical miles → UTM zone + easting/northing in metres
  function entXYtoUTM(x, y, region) {
    let plh, a, X0, y0, utmX0, utmY0
    if (region === 1) {
      if (x > (y + 9069) / 57.75) {
        plh = 37; a = -0.0355; X0 = 269.31; y0 = 420.42; utmX0 = 500; utmY0 = 3319
      } else {
        plh = 36; a = 0.017;   X0 = 60.87;  y0 = 363.82; utmX0 = 691; utmY0 = 3432
      }
    } else if (region === 2) {
      if (x <= (y - 6089) / -16.86) {
        plh = 36; a = 0.0784; X0 = y < 579 ? 143.42 : 88.03; y0 = y < 579 ? 222 : 936.36
        utmX0 = 500; utmY0 = y < 579 ? 3542 : 2213
      } else if (x <= (y - 18358) / -30.05) {
        plh = 37; a = 0.046844; X0 = y < 572.9 ? 447.73 : 423.67; y0 = y < 572.9 ? 304.9 : 839.1
        utmX0 = 500; utmY0 = y < 572.9 ? 3431 : 2433
      } else {
        plh = 38; a = 0.0136; X0 = y < 581 ? 760.3 : 752.72; y0 = y < 581 ? 312.89 : 849.98
        utmX0 = 500; utmY0 = y < 581 ? 3430 : 2434
      }
    } else if (region === 3) {
      plh = 36; a = 0; X0 = 163.37; y0 = 363.67; utmX0 = 500; utmY0 = 3762
    } else { // region 4
      if (x >= (y - 6640) / -10.75) {
        plh = 36; a = 0.0546; X0 = y < 650 ? 714.3 : 685.1; y0 = y < 650 ? 379.3 : 914.7
        utmX0 = 500; utmY0 = y < 650 ? 4760 : 3763
      } else if (x >= (y - 2192) / -5.78) {
        plh = 35; a = 0.13; X0 = y < 570 ? 458 : 388; y0 = y < 570 ? 300 : 832
        utmX0 = 500; utmY0 = y < 570 ? 4872 : 3875
      } else {
        plh = 34; a = 0.209; X0 = y < 500 ? 214 : 92; y0 = y < 500 ? 199.6 : 784
        utmX0 = 500; utmY0 = y < 500 ? 4985 : 3875
      }
    }
    let xc, yc
    if (a === 0) {
      xc = X0; yc = y
    } else {
      const at = -1 / a
      const b  = y0 - at * X0
      xc = (b - (y - a * x)) / (a - at)
      yc = at * xc + b
    }
    let dx = Math.sqrt((y - yc) ** 2 + (x - xc) ** 2)
    let dy = Math.sqrt((yc - y0) ** 2 + (xc - X0) ** 2)
    if (yc > y0) dy = -dy
    if (x < xc) dx = -dx
    return {
      zone:     plh,
      easting:  Math.round(utmX0 + dx * 1.852) * 1000,
      northing: Math.round(utmY0 + dy * 1.852) * 1000,
    }
  }

  const handleImportEnt = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setFileImportError(null)
    setFileImportStatus(`📂 Reading "${file.name}"…`)
    try {
      // Decode Windows-1255 (Hebrew)
      const buf  = await file.arrayBuffer()
      const text = new TextDecoder('windows-1255').decode(buf)
      const lines = text.split(/\r?\n/)

      const stripVal = s => s.trim().replace(/^"(.*)"$/, '$1')

      // Parse header — line count depends on version
      const version = parseFloat(lines[0])
      const count   = parseInt(lines[1])

      if (isNaN(count) || count < 1) throw new Error('Invalid .ent file — bad waypoint count')
      if (version < 1.51) throw new Error('Unsupported .ent version (< 1.51)')

      // Header layout:
      //  v<1.6:  22 lines (no blnCalcAlpha, deltaalphafuel present, no FUEL(1), Region at idx 21)
      //  v>=1.6, <1.7: 23 lines (blnCalcAlpha present, FUEL(1) present, Region at idx 22)
      //  v>=1.7: 24 lines (tLatLon also present, Region at idx 23)
      const HEADER_LINES = version >= 1.7 ? 24 : version >= 1.6 ? 23 : 22
      const regionLine   = HEADER_LINES - 1
      const region       = parseInt(lines[regionLine])

      if (isNaN(region) || region < 1 || region > 4) throw new Error('Invalid .ent file — unrecognised region')
      const BLOCK = 14
      const entries = []
      for (let i = 0; i < count; i++) {
        const base = HEADER_LINES + i * BLOCK
        const name = stripVal(lines[base + 13] ?? '')
        if (!name) continue // skip empty/placeholder waypoints
        const xVal = parseFloat(lines[base + 5])
        const yVal = parseFloat(lines[base + 6])
        if (!xVal && !yVal) continue
        entries.push({
          name,
          alt_ft:    parseFloat(lines[base + 0]) || 0,
          oat_c:     parseFloat(lines[base + 1]),
          tas_kt:    parseFloat(lines[base + 2]) || 0,
          wind_dir:  parseFloat(lines[base + 3]) || 0,
          wind_spd:  parseFloat(lines[base + 4]) || 0,
          x: xVal, y: yVal,
        })
      }

      if (entries.length === 0) throw new Error('No valid waypoints found in file')

      // Convert screen coords → lat/lon
      setFileImportStatus(`🔄 Converting ${entries.length} coordinates…`)
      const coords = entries.map(({ x, y }) => {
        const { zone, easting, northing } = entXYtoUTM(x, y, region)
        return utmToLatLonJS(zone, 'N', easting, northing)
      })

      // Fetch elevations
      setFileImportStatus(`🛰 Fetching elevations (${entries.length} points)…`)
      const elevations = await Promise.all(
        coords.map(({ lat, lon }) => fetchElevation(lat, lon).catch(() => ({ elevation_ft: 0 })))
      )

      const offset = parseInt(aglOffset) || 1000
      const wpts = coords.map(({ lat, lon }, i) => {
        const elev    = elevations[i]?.elevation_ft ?? 0
        const altFt   = entries[i].alt_ft > 0 ? entries[i].alt_ft : (altMode === 'MSL' ? offset : Math.round(elev + offset))
        const fileOat = entries[i].oat_c
        const oat     = isNaN(fileOat) ? parseFloat(computeOat(String(altFt), seaLevelTemp)) : fileOat
        return {
          ...DEFAULT_WPT,
          name:           entries[i].name,
          lat:            String(lat),
          lon:            String(lon),
          surface_alt_ft: String(Math.round(elev)),
          alt_ft:         String(altFt),
          oat_c:          String(oat),
          oat_auto:       isNaN(fileOat),
          ...(entries[i].tas_kt > 0 && { airspeed_kts: String(entries[i].tas_kt) }),
          wind_dir:       String(entries[i].wind_dir),
          wind_speed_kts: String(entries[i].wind_spd),
        }
      })

      updateRoute(activeRouteId, r => ({ ...r, waypoints: wpts, results: null }))
      setFileImportStatus(`✔ Loaded ${wpts.length} waypoints from "${file.name}"`)
    } catch (err) {
      setFileImportStatus(null)
      setFileImportError('Could not read Einat file — ' + err.message)
    }
  }

  const removeWaypoint = (idx) => {
    saveToUndoStack()
    setWaypoints(w => w.filter((_, i) => i !== idx))
    if (targetWptIdx === idx) setTargetWptIdx(null)
    else if (targetWptIdx > idx) setTargetWptIdx(t => t - 1)
  }

  const reverseWaypoints = () => {
    saveToUndoStack()
    setWaypoints(w => [...w].reverse())
    setResults(null); setStopAlert(null)
    setActiveWpt(null)
  }

  const reorderWaypoints = (fromIdx, toIdx) => {
    saveToUndoStack()
    setWaypoints(w => {
      const arr = [...w]
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return arr
    })
    setResults(null); setStopAlert(null)
    setActiveWpt(prev => {
      if (prev === null) return null
      if (prev === fromIdx) return toIdx
      if (fromIdx < toIdx && prev > fromIdx && prev <= toIdx) return prev - 1
      if (fromIdx > toIdx && prev < fromIdx && prev >= toIdx) return prev + 1
      return prev
    })
  }

  const handleSetTarget = (idx) => {
    if (targetWptIdx !== null && targetWptIdx !== idx) {
      if (!window.confirm(`Change target from "${waypoints[targetWptIdx]?.name}" to "${waypoints[idx]?.name}"?`)) return
    }
    setTargetWptIdx(prev => prev === idx ? null : idx)
  }

  const addRoute = () => {
    if (routes.length >= 10) return
    saveToUndoStack()
    const id = routeIdRef.current++
    const color = ROUTE_COLORS[id % ROUTE_COLORS.length]
    const r = {
      id, name: `Route ${routes.length + 1}`, visible: true, color,
      config: { ...ROUTE_CONFIG_DEFAULTS },
      waypoints: [],
      results: null,
    }
    setRoutes(rs => [...rs, r])
    setActiveRouteId(id)
    setActiveWpt(null); setTargetWptIdx(null)
  }

  const duplicateRoute = (id) => {
    if (routes.length >= 10) return
    saveToUndoStack()
    const src = routes.find(r => r.id === id); if (!src) return
    const newId = routeIdRef.current++
    const color = ROUTE_COLORS[newId % ROUTE_COLORS.length]
    const dup = { ...src, id: newId, name: `${src.name} copy`, color, results: null }
    setRoutes(rs => {
      const idx = rs.findIndex(r => r.id === id)
      const next = [...rs]; next.splice(idx + 1, 0, dup); return next
    })
    setActiveRouteId(newId); setActiveWpt(null); setTargetWptIdx(null)
  }

  const deleteRoute = (id) => {
    if (routes.length <= 1) return
    saveToUndoStack()
    const next = routes.filter(r => r.id !== id)
    setRoutes(next)
    if (activeRouteId === id) { setActiveRouteId(next[0].id); setActiveWpt(null); setTargetWptIdx(null) }
  }

  const renameRoute     = (id, name) => {
    saveToUndoStack()
    updateRoute(id, r => ({ ...r, name: name || r.name }))
  }
  const reorderRoutes   = (fromId, toId) => {
    saveToUndoStack()
    setRoutes(rs => {
      const arr = [...rs]
      const fromIdx = arr.findIndex(r => r.id === fromId)
      const toIdx   = arr.findIndex(r => r.id === toId)
      if (fromIdx === -1 || toIdx === -1) return rs
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return arr
    })
  }
  const toggleRouteVis  = (id)       => {
    saveToUndoStack()
    updateRoute(id, r => ({ ...r, visible: !r.visible }))
  }
  const showAllRoutes   = ()          => setRoutes(rs => rs.map(r => ({ ...r, visible: true })))
  const hideAllRoutes   = ()          => setRoutes(rs => rs.map(r => ({ ...r, visible: false })))

  const selectRoute = (id) => {
    if (id === activeRouteId) return
    setActiveRouteId(id); setActiveWpt(null); setTargetWptIdx(null)
    setSelectedWpt(null); setSelectedLeg(null)
  }

  const importRouteJson = (e) => {
    const file = e.target.files[0]; if (!file) return
    e.target.value = ''
    if (routes.length >= 10) { setError('Cannot add route — maximum of 10 routes per project reached. Delete an existing route first.'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const m = JSON.parse(ev.target.result)
        const wpts = Array.isArray(m.waypoints)
          ? m.waypoints.map(wp => ({ ...DEFAULT_WPT, ...wp, oat_auto: wp.oat_auto ?? true }))
          : []
        if (wpts.length === 0) { setError('No waypoints found in this file — the JSON file may be empty or not a valid Ilana route export'); return }
        const id = routeIdRef.current++
        const color = ROUTE_COLORS[id % ROUTE_COLORS.length]
        const name = m.project_name || file.name.replace(/\.json$/i, '') || `Route ${routes.length + 1}`
        setRoutes(rs => [...rs, { id, name, visible: true, color, config: { ...ROUTE_CONFIG_DEFAULTS }, waypoints: wpts, results: null }])
        setActiveRouteId(id); setActiveWpt(null)
      } catch { setError('Could not read file — not a valid Ilana route file (.json)') }
    }
    reader.readAsText(file)
  }

  const importRouteXls = async (e) => {
    const file = e.target.files[0]; if (!file) return
    e.target.value = ''
    if (routes.length >= 10) { setError('Cannot add route — maximum of 10 routes per project reached. Delete an existing route first.'); return }
    try {
      const { mission: m, waypoints: wpts } = await importFromExcel(file)
      const id = routeIdRef.current++
      const color = ROUTE_COLORS[id % ROUTE_COLORS.length]
      const name = m.route_name || m.project_name || file.name.replace(/\.xlsx?$/i, '') || `Route ${routes.length + 1}`
      setRoutes(rs => [...rs, { id, name, visible: true, color, config: { ...ROUTE_CONFIG_DEFAULTS }, waypoints: wpts.map(wp => ({ ...DEFAULT_WPT, ...wp })), results: null }])
      setActiveRouteId(id); setActiveWpt(null)
    } catch (err) { setError(`Could not read Excel file — make sure it's a valid Galaxy export (.xlsx/.xls): ${err.message}`) }
  }

  const updateWaypoint = (idx, field, value) => {
    saveToUndoStack()
    setWaypoints(w => w.map((wp, i) => {
      // spare_pct propagates forward from idx to end of route (VB6 txtpntSPARE_Change)
      if (field === 'spare_pct') return i >= idx ? { ...wp, spare_pct: value } : wp
      if (i !== idx) return wp
      const updated = { ...wp, [field]: value }
      if (field === 'alt_ft' && updated.oat_auto)
        updated.oat_c = computeOat(value, seaLevelTempRef.current)
      if (field === 'oat_c')
        updated.oat_auto = false
      return updated
    }))
  }

  const applyMapMove = async (wptIdx, lat, lon) => {
    setWaypoints(w => w.map((p, i) => i === wptIdx
      ? { ...p, lat: lat.toFixed(6), lon: lon.toFixed(6), alt_ft: '…' }
      : p))
    try {
      const { elevation_ft } = await fetchElevation(lat, lon)
      const offset = parseInt(aglOffset) || 1000
      const newAlt = altMode === 'MSL'
        ? String(offset)
        : String(Math.round(elevation_ft + offset))
      const oat = computeOat(newAlt, seaLevelTempRef.current)
      setWaypoints(w => w.map((p, i) => i === wptIdx
        ? { ...p, surface_alt_ft: String(Math.round(elevation_ft)), alt_ft: newAlt, oat_c: String(oat) }
        : p))
    } catch {
      setWaypoints(w => w.map((p, i) => i === wptIdx
        ? { ...p, alt_ft: String(parseInt(aglOffset) || 1000) }
        : p))
    }
  }

  const onMapClick = useCallback(async (lat, lon) => {
    if (bingoTargetMode) {
      setPendingBingoTarget({ lat, lon })
      setBingoTargetMode(false)
      return
    }
    if (mapAddMode) {
      // Add new waypoint at clicked position
      const offset = parseInt(aglOffset) || 1000
      const newWpt = {
        ...DEFAULT_WPT,
        lat: lat.toFixed(6), lon: lon.toFixed(6),
        alt_ft: String(offset),
        airspeed_kts: String(DEFAULT_WPT.airspeed_kts),
        oat_c: String(DEFAULT_WPT.oat_c),
        oat_auto: true,
      }
      setWaypoints(w => {
        const name = `WP${w.length + 1}`
        return [...w, { ...newWpt, name }]
      })
      // Async: fill elevation + OAT
      try {
        const { elevation_ft } = await fetchElevation(lat, lon)
        setWaypoints(w => {
          const idx = w.findIndex(p => p.lat === lat.toFixed(6) && p.lon === lon.toFixed(6))
          if (idx === -1) return w
          const newAlt = altMode === 'MSL'
            ? String(offset)
            : String(Math.round(elevation_ft + offset))
          const oat = computeOat(newAlt, seaLevelTempRef.current)
          return w.map((p, i) => i === idx
            ? { ...p, surface_alt_ft: String(Math.round(elevation_ft)), alt_ft: newAlt, oat_c: String(oat) }
            : p)
        })
      } catch { /* elevation optional */ }
      return
    }
    if (activeWpt === null) return
    setPendingMapMove({ lat, lon, wptIdx: activeWpt })
  }, [bingoTargetMode, mapAddMode, activeWpt, aglOffset, altMode, results])   // eslint-disable-line

  const handleCalculate = async () => {
    setError(null); setResults(null); setStopAlert(null); setSuggestResult(null); setLoading(true)

    // Validate each waypoint field before sending — catches '…' loading placeholders and empty values
    const WPT_FIELDS = [
      ['lat',          'latitude'],
      ['lon',          'longitude'],
      ['alt_ft',       'altitude'],
      ['airspeed_kts', 'airspeed'],
      ['oat_c',        'temperature'],
    ]
    for (let i = 0; i < waypoints.length; i++) {
      const w    = waypoints[i]
      const name = w.name || `WP${i + 1}`
      for (const [field, label] of WPT_FIELDS) {
        const raw = w[field]
        if (raw === '…' || raw === '...')   { setError(`${name}: ${label} is still loading — wait for the elevation lookup to finish`); setLoading(false); return }
        if (raw === '' || raw == null)       { setError(`${name}: ${label} is missing — fill in all waypoint fields before calculating`); setLoading(false); return }
        if (isNaN(parseFloat(raw)))          { setError(`${name}: ${label} has an invalid value ("${raw}") — a number is expected`);     setLoading(false); return }
      }
    }
    if (!initFuel || isNaN(parseFloat(initFuel))) { setError('Initial fuel is missing — enter the starting fuel load (lbs) in the weight panel before calculating'); setLoading(false); return }

    const fuelNum = parseFloat(initFuel)
    const eftCountCalc = countStore(stationsConfig, 'eft_230')
    const maxFuelCalc = 2500 + (eftCountCalc * 1500)
    if (fuelNum < 0 || fuelNum > maxFuelCalc) { setError(`Initial fuel invalid — tank capacity max ${maxFuelCalc} lbs (internal 2500 + ${eftCountCalc} EFT ×1500)`); setLoading(false); return }

    // Validate missile/rocket loads against launcher counts
    const hfMax = hfCount * 4
    const eoMax = eoCount * 4
    const rktMax = 9

    const hfNum = parseFloat(hfMissiles)
    const eoNum = parseFloat(eoMissiles)
    const rktNum = parseFloat(rocketRounds)

    if (hfCount > 0 && (isNaN(hfNum) || hfNum < 0 || hfNum > hfMax)) {
      setError(`AGM-114: invalid count — ${hfCount} launcher${hfCount > 1 ? 's' : ''} max ${hfMax} missiles`); setLoading(false); return
    }
    if (eoCount > 0 && (isNaN(eoNum) || eoNum < 0 || eoNum > eoMax)) {
      setError(`EO launcher: invalid count — ${eoCount} launcher${eoCount > 1 ? 's' : ''} max ${eoMax} missiles`); setLoading(false); return
    }
    if (rktCount > 0 && (isNaN(rktNum) || rktNum < 0 || rktNum > rktMax)) {
      setError(`Rockets: invalid count — max ${rktMax} rockets`); setLoading(false); return
    }

    try {
      const data = await calculateFlightPlan({
        variant,
        empty_weight_lbs: configuredEmptyWt,
        initial_fuel_lbs: parseFloat(initFuel),
        etf_eng1: parseFloat(etfEng1) || 0.95,
        etf_eng2: parseFloat(etfEng2) || 0.95,
        n_bidons: countStore(stationsConfig, 'eft_230'),
        delta_f: Math.round((globalAtf - 1) * 100 * 1000) / 1000,
        csp_index: (cspWptIdx !== null && cspFuel) ? cspWptIdx : null,
        csp_fuel:  (cspWptIdx !== null && cspFuel) ? parseFloat(cspFuel) : null,
        wca_thresholds: {
          warnings_enabled:           true,
          warn_delta_torque_pct:      settings.wcaWarnDeltaTorque,
          warn_cruise_torque_pct:     settings.wcaWarnCruiseTorque,
          warn_min_fuel_lbs:          settings.wcaWarnMinFuel,
          warn_max_gw_lbs:            settings.wcaWarnMaxGw,
          cautions_enabled:                  settings.wcaCautionsEnabled,
          caution_delta_torque_enabled:      settings.wcaCautionDeltaTorqueEnabled,
          caution_delta_torque_pct:          settings.wcaCautionDeltaTorque,
          caution_cruise_torque_enabled:     settings.wcaCautionCruiseTorqueEnabled,
          caution_cruise_torque_pct:         settings.wcaCautionCruiseTorque,
          caution_terrain_enabled:           settings.wcaCautionTerrainEnabled,
          caution_terrain_margin_ft:         settings.wcaCautionTerrainMargin,
          advisories_enabled:                settings.wcaAdvisoriesEnabled,
          advisory_delta_torque_enabled:     settings.wcaAdvisoryDeltaTorqueEnabled,
          advisory_delta_torque_pct:         settings.wcaAdvisoryDeltaTorque,
          advisory_cruise_torque_enabled:    settings.wcaAdvisoryCruiseTorqueEnabled,
          advisory_cruise_torque_pct:        settings.wcaAdvisoryCruiseTorque,
          advisory_fuel_enabled:             settings.wcaAdvisoryFuelEnabled,
          advisory_min_fuel_lbs:             settings.wcaAdvisoryMinFuel,
        },
        waypoints: waypoints.map((w, i) => ({
          name: w.name || `WP${i + 1}`,
          lat: parseFloat(w.lat), lon: parseFloat(w.lon),
          alt_ft: parseFloat(w.alt_ft), airspeed_kts: parseFloat(w.airspeed_kts),
          oat_c: parseFloat(w.oat_c),
          hold_type: w.hold_type || null,
          hold_min: parseFloat(w.hold_min) || 0,
          hold_speed_kts: parseFloat(w.hold_speed_kts) || 80,
          atf: globalAtf,
          spare_pct: Math.max(-5, Math.min(40, parseInt(w.spare_pct) || 0)),
          wind_dir: Math.max(0, Math.min(360, parseInt(w.wind_dir) || 0)),
          wind_speed_kts: Math.max(0, parseFloat(w.wind_speed_kts) || 0),
        })),
      })
      setResults(data)
      setTableFolded(false)
      setStopAlert(data.stop_alert ?? null)
    } catch (e) { setError(`Calculation error: ${e.message}`) }
    finally { setLoading(false) }
  }

  // ── Climb Speed Suggestion ────────────────────────────────────────────────
  const handleSuggestSpeed = async () => {
    if (!stopAlert || !results) return
    // Find the departure waypoint index (match stop lat/lon to waypoints)
    let wptIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < waypoints.length - 1; i++) {
      const w = waypoints[i]
      const lat = parseFloat(w.lat); const lon = parseFloat(w.lon)
      if (isNaN(lat) || isNaN(lon)) continue
      const d = Math.abs(lat - stopAlert.lat) + Math.abs(lon - stopAlert.lon)
      if (d < bestDist) { bestDist = d; wptIdx = i }
    }
    if (wptIdx < 0 || wptIdx >= waypoints.length - 1) return

    const wfromRaw = waypoints[wptIdx]
    const wtoRaw   = waypoints[wptIdx + 1]

    // Only suggest for climb or level legs (not descent)
    const altFrom = parseFloat(wfromRaw.alt_ft)
    const altTo   = parseFloat(wtoRaw.alt_ft)
    if (altTo < altFrom) return  // descent — no suggestion

    // Fuel at departure comes from results waypoints
    const resWpt = results.waypoints[wptIdx]
    const fuelAtDep = resWpt ? resWpt.fuel_remaining_lbs : parseFloat(initFuel) || 0

    const wfrom = {
      name: wfromRaw.name || `WP${wptIdx + 1}`,
      lat: parseFloat(wfromRaw.lat), lon: parseFloat(wfromRaw.lon),
      alt_ft: altFrom, airspeed_kts: parseFloat(wfromRaw.airspeed_kts),
      oat_c: parseFloat(wfromRaw.oat_c),
      atf: globalAtf,
      hold_type: wfromRaw.hold_type || null,
      hold_min: parseFloat(wfromRaw.hold_min) || 0,
      hold_speed_kts: parseFloat(wfromRaw.hold_speed_kts) || 80,
      spare_pct: Math.max(-5, Math.min(40, parseInt(wfromRaw.spare_pct) || 0)),
      wind_dir: Math.max(0, Math.min(360, parseInt(wfromRaw.wind_dir) || 0)),
      wind_speed_kts: Math.max(0, parseFloat(wfromRaw.wind_speed_kts) || 0),
    }
    const wto = {
      name: wtoRaw.name || `WP${wptIdx + 2}`,
      lat: parseFloat(wtoRaw.lat), lon: parseFloat(wtoRaw.lon),
      alt_ft: altTo, airspeed_kts: parseFloat(wtoRaw.airspeed_kts),
      oat_c: parseFloat(wtoRaw.oat_c),
      atf: globalAtf,
      hold_type: wtoRaw.hold_type || null,
      hold_min: parseFloat(wtoRaw.hold_min) || 0,
      hold_speed_kts: parseFloat(wtoRaw.hold_speed_kts) || 80,
      spare_pct: Math.max(-5, Math.min(40, parseInt(wtoRaw.spare_pct) || 0)),
      wind_dir: Math.max(0, Math.min(360, parseInt(wtoRaw.wind_dir) || 0)),
      wind_speed_kts: Math.max(0, parseFloat(wtoRaw.wind_speed_kts) || 0),
    }

    setSuggestLoading(true)
    setSuggestResult(null)
    try {
      const res = await suggestClimbSpeed({
        variant,
        empty_weight_lbs: configuredEmptyWt,
        fuel_at_departure_lbs: fuelAtDep,
        etf_eng1: parseFloat(etfEng1) || 0.95,
        etf_eng2: parseFloat(etfEng2) || 0.95,
        n_bidons: countStore(stationsConfig, 'eft_230'),
        delta_f: Math.round((globalAtf - 1) * 100 * 1000) / 1000,
        wfrom,
        wto,
        wca_thresholds: {
          warnings_enabled:           true,
          warn_delta_torque_pct:      settings.wcaWarnDeltaTorque,
          warn_cruise_torque_pct:     settings.wcaWarnCruiseTorque,
          warn_min_fuel_lbs:          settings.wcaWarnMinFuel,
          warn_max_gw_lbs:            settings.wcaWarnMaxGw,
          cautions_enabled:                  settings.wcaCautionsEnabled,
          caution_delta_torque_enabled:      settings.wcaCautionDeltaTorqueEnabled,
          caution_delta_torque_pct:          settings.wcaCautionDeltaTorque,
          caution_cruise_torque_enabled:     settings.wcaCautionCruiseTorqueEnabled,
          caution_cruise_torque_pct:         settings.wcaCautionCruiseTorque,
          caution_terrain_enabled:           settings.wcaCautionTerrainEnabled,
          caution_terrain_margin_ft:         settings.wcaCautionTerrainMargin,
          advisories_enabled:                settings.wcaAdvisoriesEnabled,
          advisory_delta_torque_enabled:     settings.wcaAdvisoryDeltaTorqueEnabled,
          advisory_delta_torque_pct:         settings.wcaAdvisoryDeltaTorque,
          advisory_cruise_torque_enabled:    settings.wcaAdvisoryCruiseTorqueEnabled,
          advisory_cruise_torque_pct:        settings.wcaAdvisoryCruiseTorque,
          advisory_fuel_enabled:             settings.wcaAdvisoryFuelEnabled,
          advisory_min_fuel_lbs:             settings.wcaAdvisoryMinFuel,
        },
      })
      setSuggestResult({ ...res, wptIdx })
    } catch (e) {
      setSuggestResult({ found: false, message: `Error: ${e.message}`, wptIdx, original_tas_kts: parseFloat(wfromRaw.airspeed_kts) })
    } finally {
      setSuggestLoading(false)
    }
  }

  // Determine whether the Suggest Speed button should appear
  const suggestApplicable = (() => {
    if (!stopAlert) return false
    if (!['DELTA_TRQ', 'CRUISE_TRQ'].includes(stopAlert.code)) return false
    // Find departure waypoint
    let wptIdx = -1; let bestDist = Infinity
    for (let i = 0; i < waypoints.length - 1; i++) {
      const w = waypoints[i]
      const lat = parseFloat(w.lat); const lon = parseFloat(w.lon)
      if (isNaN(lat) || isNaN(lon)) continue
      const d = Math.abs(lat - stopAlert.lat) + Math.abs(lon - stopAlert.lon)
      if (d < bestDist) { bestDist = d; wptIdx = i }
    }
    if (wptIdx < 0 || wptIdx >= waypoints.length - 1) return false
    const altFrom = parseFloat(waypoints[wptIdx].alt_ft)
    const altTo   = parseFloat(waypoints[wptIdx + 1]?.alt_ft)
    return !isNaN(altFrom) && !isNaN(altTo) && altTo >= altFrom
  })()

  const validWpts = waypoints
    .map((w, i) => ({ ...w, index: i }))
    .filter(w => w.lat && w.lon && !isNaN(parseFloat(w.lat)) && !isNaN(parseFloat(w.lon)))

  const bgRoutes = routes
    .filter(r => r.id !== activeRouteId && r.visible)
    .map(r => ({
      name: r.name,
      color: r.color,
      waypoints: r.waypoints
        .map((w, i) => ({ ...w, index: i }))
        .filter(w => w.lat && w.lon && !isNaN(parseFloat(w.lat)) && !isNaN(parseFloat(w.lon))),
    }))

  // ── Shared styles ──────────────────────────────────────────────────────────
  const inputStyle = {
    width: '100%', background: t.bg3, border: `1px solid ${t.border0}`,
    borderRadius: 3, padding: '3px 7px', color: t.text0, fontSize: 12, fontFamily: t.font,
  }
  const sectionInputStyle = {
    width: '100%', background: t.bg2, border: `1px solid ${t.border0}`,
    borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11, fontFamily: t.font,
  }
  const validStyle = (value, min, max, base = inputStyle) => {
    const num = parseFloat(value)
    const hasVal = value !== '' && value !== '-' && !isNaN(num)
    const invalid = hasVal && (num < min || num > max)
    return invalid ? { ...base, border: `1px solid ${t.warn}`, background: t.warn + '22', color: t.warn } : base
  }
  const iconBtnStyle = {
    padding: '3px 9px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
    background: t.bg5, border: `1px solid ${t.border1}`, borderRadius: 3,
    color: t.accent, cursor: 'pointer', fontFamily: t.font,
  }
  const btnStyle = (disabled) => ({
    width: '100%', padding: '9px 0', borderRadius: 4,
    background: disabled ? t.btnBgDisabled : t.btnBg,
    color: disabled ? t.btnTextDisabled : t.btnText,
    fontWeight: 700, fontSize: 12, letterSpacing: 1,
    border: `1px solid ${disabled ? t.border0 : t.border1}`,
    cursor: disabled ? 'default' : 'pointer', fontFamily: t.font,
  })
  const badge = (value, color) => (
    <span style={{
      fontWeight: 700, fontSize: 12, color,
      background: t.bg3, padding: '2px 9px', borderRadius: 3,
      border: `1px solid ${color}`, letterSpacing: 1, fontFamily: t.font,
    }}>{value}</span>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: t.font, background: t.bg0 }}>

      {/* ── About modal ─────────────────────────────────────────────────── */}
      {showAbout && (
        <div onClick={() => { setShowAbout(false);  }} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `2px solid ${t.accent}`, borderRadius: 8,
            padding: '28px 36px', minWidth: 380, fontFamily: t.font,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <img src="/logo.png" alt="ILANA" style={{ height: 72, width: 72, objectFit: 'contain', borderRadius: 6 }} />
              <div>
                <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: 4, color: t.accent }}>ILANA</div>
                <div style={{ fontSize: 9, color: t.text2, letterSpacing: 3, fontWeight: 600 }}>APACHE · MISSION PLANNER</div>
              </div>
            </div>

            {/* Online / Offline toggle */}
            <div style={{
              borderTop: `1px solid ${t.border0}`, paddingTop: 14, marginBottom: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.text0, letterSpacing: 1, marginBottom: 3 }}>
                  MAP SOURCE
                </div>
                <div style={{ fontSize: 10, color: t.text3 }}>
                  {tileMode === 'online'
                    ? 'Using CDN tiles (OpenStreetMap / OpenTopoMap)'
                    : 'Using local tile server (localhost:8000)'}
                </div>
              </div>
              <button
                onClick={() => {
                  const next = tileMode === 'offline' ? 'online' : 'offline'
                  setTileMode(next)
                  localStorage.setItem('tileMode', next)
                }}
                style={{
                  padding: '6px 18px', fontFamily: t.font, fontSize: 11, fontWeight: 700,
                  letterSpacing: 1, borderRadius: 4, cursor: 'pointer',
                  background: tileMode === 'online' ? t.ok + '25' : t.bg3,
                  border: `1px solid ${tileMode === 'online' ? t.ok : t.border1}`,
                  color: tileMode === 'online' ? t.ok : t.text2,
                  minWidth: 90,
                }}>
                {tileMode === 'online' ? '🌐 ONLINE' : '📡 OFFLINE'}
              </button>
            </div>

            {/* Version */}
            <div style={{ borderTop: `1px solid ${t.border0}`, paddingTop: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: t.text3, letterSpacing: 1 }}>VERSION</span>
                <span style={{ color: t.accent, fontWeight: 700 }}>1.0.0</span>
                <span style={{ color: t.text3 }}>·</span>
                <span style={{ color: t.text1 }}>29 March 2026</span>
              </div>
              <div style={{ fontSize: 11, color: t.text2, marginBottom: 2 }}>AH-64D Apache flight planning utility</div>
              <div style={{ fontSize: 11, color: t.text2 }}>Designed for Israeli Air Force operations</div>
            </div>

            {/* Data Sources */}
            <div style={{ borderTop: `1px solid ${t.border0}`, paddingTop: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2, marginBottom: 10 }}>DATA SOURCES</div>

              {!dataStatus
                ? <div style={{ fontSize: 10, color: t.text3 }}>Loading…</div>
                : [
                  { key: 'map_tiles',  label: 'MAP TILES',          icon: '🗺' },
                  { key: 'topo_tiles', label: 'TOPOGRAPHIC TILES',   icon: '🏔' },
                  { key: 'elevation',  label: 'ELEVATION (DSM)',      icon: '⛰' },
                ].map(({ key, label, icon }) => {
                  const d  = dataStatus[key]
                  const ok = d?.available
                  const b  = d?.bounds
                  return (
                    <div key={key} style={{
                      display: 'flex', gap: 10, marginBottom: 10,
                      padding: '8px 10px', borderRadius: 5,
                      background: t.bg2, border: `1px solid ${ok ? t.border0 : t.border2}`,
                    }}>
                      <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        {/* Title + status badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: t.text0, letterSpacing: 1 }}>
                            {label}
                          </span>
                          <span style={{
                            fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '1px 5px',
                            borderRadius: 2, background: ok ? '#1a3a1a' : '#2a1a1a',
                            color: ok ? t.ok : t.warn, border: `1px solid ${ok ? t.ok : t.warn}`,
                          }}>
                            {ok ? 'OFFLINE' : 'NOT AVAILABLE'}
                          </span>
                        </div>

                        {ok ? (
                          <div style={{ fontSize: 10, color: t.text2, lineHeight: 1.7 }}>
                            {/* Coverage bounds */}
                            {b && (
                              <div>
                                <span style={{ color: t.text3 }}>Coverage: </span>
                                <span style={{ color: t.text1 }}>
                                  {b.lon_min}°{b.lon_min >= 0 ? 'E' : 'W'} – {b.lon_max}°{b.lon_max >= 0 ? 'E' : 'W'}
                                  &nbsp;·&nbsp;
                                  {b.lat_min}°{b.lat_min >= 0 ? 'N' : 'S'} – {b.lat_max}°{b.lat_max >= 0 ? 'N' : 'S'}
                                </span>
                              </div>
                            )}
                            {/* Zoom range (tiles only) */}
                            {b?.zoom_min !== undefined && (
                              <div>
                                <span style={{ color: t.text3 }}>Zoom: </span>
                                <span style={{ color: t.text1 }}>{b.zoom_min} – {b.zoom_max}</span>
                              </div>
                            )}
                            {/* Resolution (DSM only) */}
                            {d.resolution && (
                              <div>
                                <span style={{ color: t.text3 }}>Resolution: </span>
                                <span style={{ color: t.text1 }}>{d.resolution} &nbsp;·&nbsp; SRTM3 HGT</span>
                              </div>
                            )}
                            {/* Tile count + size */}
                            <div>
                              <span style={{ color: t.text3 }}>Files: </span>
                              <span style={{ color: t.text1 }}>
                                {d.tile_count?.toLocaleString()} tiles
                                {d.size_mb ? ` · ${d.size_mb.toLocaleString()} MB` : ''}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: t.text3 }}>
                            {key === 'map_tiles'  ? 'Run  python3 download_tiles.py  to download'
                           : key === 'topo_tiles' ? 'Run  python3 download_tiles.py --style topo  to download'
                           :                        'Run  python3 download_dem.py  to download'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              }
            </div>

            <div style={{ fontSize: 10, color: t.text3, borderTop: `1px solid ${t.border0}`, paddingTop: 12 }}>
              © 2006 Amit Bouzaglo · All rights reserved
            </div>

            <button onClick={() => { setShowAbout(false);  }}
              style={{ ...iconBtnStyle, marginTop: 16, width: '100%', padding: '6px 0', textAlign: 'center' }}>
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* ── Help modal ──────────────────────────────────────────────────── */}
      {showHelp && (
        <div onClick={() => { setShowHelp(false); setHelpTopic(null) }} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `2px solid ${t.accent}`, borderRadius: 8,
            padding: '28px 36px', width: 520, maxHeight: '85vh', overflowY: 'auto',
            fontFamily: t.font,
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              {helpTopic && (
                <button onClick={() => setHelpTopic(null)} style={{
                  ...iconBtnStyle, padding: '2px 8px', fontSize: 10, marginRight: 4,
                }}>← BACK</button>
              )}
              <span style={{ fontSize: 20, color: t.accent }}>?</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 3, color: t.accent }}>
                  {helpTopic === 'maps' ? 'UPDATE MAPS' : helpTopic === 'dsm' ? 'UPDATE DSM' : 'HELP'}
                </div>
                <div style={{ fontSize: 9, color: t.text2, letterSpacing: 2 }}>ILANA · APACHE MISSION PLANNER</div>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${t.border0}`, paddingTop: 18 }}>

              {/* ── Topic list ─────────────────────────────────────────── */}
              {!helpTopic && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2, marginBottom: 4 }}>DATA MANAGEMENT</div>
                  {[
                    { id: 'maps', icon: '🗺', title: 'HOW TO UPDATE MAPS',
                      sub: 'Tile files, zone coverage, download script' },
                    { id: 'dsm',  icon: '⛰', title: 'HOW TO UPDATE DSM / ELEVATION',
                      sub: 'SRTM HGT tiles, VRT mosaic, zone expansion' },
                  ].map(({ id, icon, title, sub }) => (
                    <button key={id} onClick={() => setHelpTopic(id)} style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: t.bg2, border: `1px solid ${t.border0}`,
                      borderRadius: 6, padding: '12px 16px', cursor: 'pointer',
                      textAlign: 'left', width: '100%',
                    }}>
                      <span style={{ fontSize: 22 }}>{icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 12, color: t.accent, letterSpacing: 1 }}>{title}</div>
                        <div style={{ fontSize: 10, color: t.text3, marginTop: 2 }}>{sub}</div>
                      </div>
                      <span style={{ marginLeft: 'auto', color: t.text3, fontSize: 14 }}>›</span>
                    </button>
                  ))}
                </div>
              )}

              {/* ── MAPS topic ─────────────────────────────────────────── */}
              {helpTopic === 'maps' && (
                <div style={{ fontSize: 11, color: t.text1, lineHeight: 1.8 }}>

                  <HelpSection title="HOW THE MAP WORKS" t={t}>
                    The app uses pre-downloaded PNG raster tiles served locally by the
                    backend. Each tile is a small image of a map region at a specific
                    zoom level. No internet connection is needed once tiles are downloaded.
                  </HelpSection>

                  <HelpSection title="TILE FILE STRUCTURE" t={t}>
                    <HelpMono t={t}>data/tiles/{'{z}'}/{'{x}'}/{'{y}'}.png</HelpMono>
                    <div style={{ marginTop: 6, color: t.text2 }}>
                      <b style={{ color: t.text1 }}>z</b> — zoom level (0 = world, 12 = town)<br/>
                      <b style={{ color: t.text1 }}>x</b> — tile column (left to right)<br/>
                      <b style={{ color: t.text1 }}>y</b> — tile row (top to bottom, Mercator)<br/>
                      Current coverage: <b style={{ color: t.accent }}>UTM Zones 34–40</b> (lon 18–60°E, lat 7–62°N), zoom 0–11
                    </div>
                  </HelpSection>

                  <HelpSection title="TO ADD A NEW ZONE OR MORE ZOOM LEVELS" t={t}>
                    Edit <HelpMono t={t}>download_tiles.py</HelpMono> (next to the ilana-web folder):
                    <HelpCode t={t}>{`# Current settings (zones 34–40):
LON_MIN, LON_MAX = 17.5, 60.5
LAT_MIN, LAT_MAX =  6.5, 62.5
MAX_ZOOM_DEFAULT = 11   # ~128K tiles

# Example — extend to zoom 12 (5× more tiles, adds street detail):
python3 download_tiles.py --zoom 12

# Example — narrow to one country area only:
LON_MIN, LON_MAX = 29.5, 36.5   # Israel / Jordan`}</HelpCode>
                    Then run from terminal:
                    <HelpCode t={t}>python3 download_tiles.py</HelpCode>
                    New tiles are added without re-downloading existing ones (resumable).
                  </HelpSection>

                  <HelpSection title="MANUAL TILE PLACEMENT" t={t}>
                    You can also copy tiles from any XYZ-format tile cache
                    (e.g. from MOBAC, SAS.Planet, or another Leaflet app) directly into:
                    <HelpCode t={t}>{`data/tiles/
  12/
    2461/
      1529.png   ← one tile`}</HelpCode>
                    Restart the backend after adding files.
                  </HelpSection>

                  <HelpSection title="FILE FORMAT" t={t}>
                    <b style={{ color: t.accent }}>PNG</b> — standard 256×256 pixel tile images.<br/>
                    Source: Carto CDN (<code>basemaps.cartocdn.com</code>) · fallback: OpenStreetMap.<br/>
                    Other XYZ tile sources (Google, ESRI, etc.) use the same format.
                  </HelpSection>

                </div>
              )}

              {/* ── DSM topic ──────────────────────────────────────────── */}
              {helpTopic === 'dsm' && (
                <div style={{ fontSize: 11, color: t.text1, lineHeight: 1.8 }}>

                  <HelpSection title="HOW ELEVATION WORKS" t={t}>
                    The app reads ground elevation from local SRTM files.
                    Elevation is used for: auto-fill altitude at waypoints,
                    height profile view, and OGE feasibility checks.
                    No internet connection is needed once the DSM is downloaded.
                  </HelpSection>

                  <HelpSection title="DSM FILES LOCATION" t={t}>
                    <HelpCode t={t}>{`data/
  dem_tiles/        ← individual 1°×1° HGT files
    N32E035.hgt
    N33E035.hgt
    ...
  srtm.vrt          ← mosaic index (auto-generated, DO NOT EDIT)`}</HelpCode>
                    The backend reads <b style={{ color: t.accent }}>srtm.vrt</b> which
                    points to all the HGT tiles. You never need to merge them.
                  </HelpSection>

                  <HelpSection title="TO ADD A NEW ZONE OR EXPAND COVERAGE" t={t}>
                    Edit <HelpMono t={t}>download_dem.py</HelpMono>:
                    <HelpCode t={t}>{`# Current settings (zones 34–40):
LON_MIN, LON_MAX = 17, 61
LAT_MIN, LAT_MAX =  7, 62

# Example — narrow to one area (Israel / Jordan only):
LON_MIN, LON_MAX = 29, 37`}</HelpCode>
                    Then run:
                    <HelpCode t={t}>python3 download_dem.py</HelpCode>
                    Existing tiles are skipped. New tiles are appended.
                    The VRT is rebuilt automatically at the end.
                  </HelpSection>

                  <HelpSection title="TO REPLACE WITH A CUSTOM GeoTIFF" t={t}>
                    If you have a merged GeoTIFF (e.g. from QGIS or GDAL):
                    <HelpCode t={t}>{`# Place it at:
data/srtm.tif

# The backend checks for srtm.vrt first, then srtm.tif.
# Either file works — no code change needed.`}</HelpCode>
                  </HelpSection>

                  <HelpSection title="FILE FORMAT" t={t}>
                    <b style={{ color: t.accent }}>HGT</b> — SRTM binary height file (1°×1°, 1201×1201 pixels, 3 arc-sec ≈ 90 m).<br/>
                    Source: <code>srtm.kurviger.de</code> (public SRTM3 mirror).<br/>
                    Also compatible: <b>.tif / .vrt</b> — any GDAL-readable raster in WGS84.
                  </HelpSection>

                </div>
              )}

            </div>

            <button onClick={() => { setShowHelp(false); setHelpTopic(null) }}
              style={{ ...iconBtnStyle, marginTop: 20, width: '100%', padding: '6px 0', textAlign: 'center' }}>
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* ── New Mission confirm dialog ──────────────────────────────────── */}
      {showNewConfirm && (
        <div onClick={() => setShowNewConfirm(false)} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `2px solid ${t.warn}`, borderRadius: 8,
            padding: '28px 36px', minWidth: 320, fontFamily: t.font, textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 12 }}>⚠</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.warn, letterSpacing: 1, marginBottom: 8 }}>START NEW MISSION?</div>
            <div style={{ fontSize: 11, color: t.text2, marginBottom: 20 }}>
              All waypoints, weights and configuration<br/>will be reset to defaults. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setShowNewConfirm(false)} style={{ ...iconBtnStyle, padding: '6px 20px' }}>
                CANCEL
              </button>
              <button onClick={handleNewMission} style={{ ...iconBtnStyle, padding: '6px 20px', color: t.warn, borderColor: t.warn, background: t.bg4 }}>
                CLEAR &amp; START NEW
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Easter egg game ─────────────────────────────────────────────── */}
      {showEasterEgg && <EasterEggGame onClose={() => setShowEasterEgg(false)} />}

      {/* ── Load / XLS confirm dialog ──────────────────────────────────── */}
      {showLoadConfirm && (
        <div onClick={() => setShowLoadConfirm(null)} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `2px solid ${t.caution}`, borderRadius: 8,
            padding: '28px 36px', minWidth: 320, fontFamily: t.font, textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 12 }}>◆</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.caution, letterSpacing: 1, marginBottom: 8 }}>
              LOAD {showLoadConfirm === 'xls' ? 'EXCEL' : 'MISSION FILE'}?
            </div>
            <div style={{ fontSize: 11, color: t.text2, marginBottom: 20 }}>
              The current mission will be replaced.<br/>Unsaved changes will be lost.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setShowLoadConfirm(null)} style={{ ...iconBtnStyle, padding: '6px 20px' }}>
                CANCEL
              </button>
              <button onClick={() => {
                setShowLoadConfirm(null)
                showLoadConfirm === 'xls' ? importXlsRef.current.click() : importRef.current.click()
              }} style={{ ...iconBtnStyle, padding: '6px 20px', color: t.caution, borderColor: t.caution, background: t.bg4 }}>
                LOAD &amp; REPLACE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending map move confirm dialog ────────────────────────────── */}
      {pendingMapMove && (
        <div onClick={() => setPendingMapMove(null)} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `1px solid ${t.border1}`, borderRadius: 8,
            padding: '28px 36px', minWidth: 320, fontFamily: t.font, textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 12 }}>⚠</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.caution, letterSpacing: 1, marginBottom: 8 }}>
              MOVE {waypoints[pendingMapMove.wptIdx]?.name ?? `WP${pendingMapMove.wptIdx + 1}`}?
            </div>
            <div style={{ fontSize: 11, color: t.text2, marginBottom: 20 }}>
              {results
                ? <>The calculated route will be cleared.<br/>Are you sure you want to move this waypoint?</>
                : 'Are you sure you want to move this waypoint?'
              }
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setPendingMapMove(null)}
                style={{ ...iconBtnStyle, padding: '6px 20px', color: t.text2, borderColor: t.border1 }}>
                CANCEL
              </button>
              <button onClick={async () => {
                const { lat, lon, wptIdx } = pendingMapMove
                setPendingMapMove(null)
                setResults(null); setStopAlert(null)
                await applyMapMove(wptIdx, lat, lon)
              }} style={{ ...iconBtnStyle, padding: '6px 20px', color: t.caution, borderColor: t.caution, background: t.bg4 }}>
                {results ? 'MOVE & CLEAR ROUTE' : 'MOVE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings modal ──────────────────────────────────────────────── */}
      {showSettings && (() => {
        const D = SETTINGS_DEFAULTS
        const isModified = k => pendingSet[k] !== D[k]
        const setVal = (k, v) => setPendingSet(p => ({ ...p, [k]: v }))

        // Input commits only on blur — avoids locking while typing
        const numInput = (k, step = 1) => (
          <input
            key={`${k}-${settingsReset}`}
            type="number" step={step} defaultValue={pendingSet[k]}
            onBlur={e => {
              const n = parseFloat(e.target.value)
              if (!isNaN(n)) setVal(k, n)
              else e.target.value = pendingSet[k]
            }}
            style={{ width: 72, background: t.bg3,
              border: `1px solid ${isModified(k) ? t.caution : t.border0}`,
              borderRadius: 3, padding: '3px 6px',
              color: isModified(k) ? t.caution : t.text0,
              fontSize: 11, fontFamily: t.font, textAlign: 'right', outline: 'none' }}
          />
        )

        const Row = ({ label, k, step, unit, explanationKey }) => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 0', borderBottom: `1px solid ${t.border0}` }}>
            <span title={explanationKey ? get(explanationKey) : ''} style={{ fontSize: 10, color: isModified(k) ? t.caution : t.text2, cursor: explanationKey ? 'help' : 'default' }}>
              {label}{isModified(k) ? ' ●' : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {numInput(k, step)}
              {unit && <span style={{ fontSize: 9, color: t.text3, width: 38 }}>{unit}</span>}
            </div>
          </div>
        )

        const TABS = [
          { id: 'drag',      label: 'DRAG / ATF',  keys: ['fcrDeltaF', 'compodDeltaF', 'dfNoWeapons','dfEftIb','dfEftOb','dfHfIb','dfHfOb','dfEoIb','dfEoOb','dfRktIb','dfRktOb'] },
          { id: 'weights',   label: 'WEIGHTS',      keys: ['crewWtDefault', 'chaffFlareWtDefault', 'fcrWeight', 'compodWeight', 'jokerFuel'] },
          { id: 'armament',  label: 'ARMAMENT',     keys: ['hellfireWt', 'eoMissileWt', 'rocketRoundWt', 'gunRoundWt'] },
          { id: 'hardware',  label: 'HARDWARE',     keys: ['hwEft230', 'hwHf4rnd', 'hwEoLauncher', 'hwRocketM261'] },
        ]
        const anyModified = Object.keys(D).some(k => pendingSet[k] !== D[k])
        const tabHasMod = id => TABS.find(t => t.id === id)?.keys.some(k => isModified(k))

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: t.bg1, border: `1px solid ${t.border1}`,
                  borderRadius: 8, padding: 24, width: 480, fontFamily: t.font }}>

              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.accent, letterSpacing: 3 }}>⚙ SETTINGS</span>
                {anyModified && <span style={{ fontSize: 9, color: t.caution, letterSpacing: 1 }}>● MODIFIED</span>}
              </div>

              {confirmStep === 0 && (<>
                {/* Tab buttons */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                  {TABS.map(tab => (
                    <button key={tab.id} onClick={() => setSettingsTab(tab.id)} style={{
                      flex: 1, padding: '5px 0', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                      fontFamily: t.font, cursor: 'pointer', borderRadius: 4, transition: 'all 0.15s',
                      background: settingsTab === tab.id ? t.bg4 : 'none',
                      border: `1px solid ${settingsTab === tab.id ? t.accent : t.border0}`,
                      color: settingsTab === tab.id ? t.accent : (tabHasMod(tab.id) ? t.caution : t.text2),
                    }}>
                      {tab.label}{tabHasMod(tab.id) ? ' ●' : ''}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div style={{ minHeight: 180 }}>
                  {settingsTab === 'drag' && <>
                    <Row label="FCR ΔF (when OFF)"   k="fcrDeltaF"    step={0.01} unit="ΔF" explanationKey="fcrDeltaF" />
                    <Row label="COMPOD ΔF (when ON)" k="compodDeltaF" step={0.01} unit="ΔF" explanationKey="compodDeltaF" />
                    <div style={{ marginTop: 14, marginBottom: 4, borderTop: `1px solid ${t.border0}`, paddingTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 8px', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1 }}>STORE ΔF (sq.ft)</span>
                        <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1, textAlign: 'right', width: 72 }}>INBOARD</span>
                        <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1, textAlign: 'right', width: 72 }}>OUTBOARD</span>
                      </div>
                      {[
                        ['NO WEAPONS (baseline)', 'dfNoWeapons', null],
                        ['EFT-230',               'dfEftIb',     'dfEftOb'],
                        ['Hellfire ×4',           'dfHfIb',      'dfHfOb'],
                        ['EO Launcher',           'dfEoIb',      'dfEoOb'],
                        ['Rocket ×19',            'dfRktIb',     'dfRktOb'],
                      ].map(([label, kIb, kOb]) => (
                        <div key={kIb} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 8px', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${t.border0}` }}>
                          <span style={{ fontSize: 10, color: (isModified(kIb) || (kOb && isModified(kOb))) ? t.caution : t.text2 }} title={get(kIb)}>
                            {label}{(isModified(kIb) || (kOb && isModified(kOb))) ? ' ●' : ''}
                          </span>
                          {numInput(kIb, 0.001)}
                          {kOb ? numInput(kOb, 0.001) : <span style={{ width: 72, textAlign: 'center', fontSize: 9, color: t.text3 }}>—</span>}
                        </div>
                      ))}
                      <div style={{ fontSize: 9, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
                        Source: TM(IS) 1-1520-251-10 fig 7-42
                      </div>
                    </div>
                  </>}
                  {settingsTab === 'weights' && <>
                    <Row label="Crew"           k="crewWtDefault"       step={1} unit="lbs" explanationKey="crewWtDefault" />
                    <Row label="Chaff & Flare"  k="chaffFlareWtDefault" step={1} unit="lbs" explanationKey="chaffFlareWtDefault" />
                    <Row label="FCR system"     k="fcrWeight"           step={1} unit="lbs" explanationKey="fcrWeight" />
                    <Row label="COMPOD pod"     k="compodWeight"        step={1} unit="lbs" explanationKey="compodWeight" />
                    <Row label="Joker fuel"     k="jokerFuel"           step={1} unit="lbs" explanationKey="jokerFuel" />
                  </>}
                  {settingsTab === 'armament' && <>
                    <Row label="AGM-114 Hellfire"  k="hellfireWt"    step={1}    unit="lbs/msle" explanationKey="hellfireWt" />
                    <Row label="EO missile"        k="eoMissileWt"   step={1}    unit="lbs/msle" explanationKey="eoMissileWt" />
                    <Row label="Rocket round"      k="rocketRoundWt" step={1}    unit="lbs/rnd"  explanationKey="rocketRoundWt" />
                    <Row label="30mm gun round"    k="gunRoundWt"    step={0.01} unit="lbs/rnd"  explanationKey="gunRoundWt" />
                  </>}
                  {settingsTab === 'hardware' && <>
                    <Row label="EFT-230 pylon"           k="hwEft230"     step={1} unit="lbs" explanationKey="hwEft230" />
                    <Row label="HF-4RND launcher"        k="hwHf4rnd"     step={1} unit="lbs" explanationKey="hwHf4rnd" />
                    <Row label="EO launcher"             k="hwEoLauncher" step={1} unit="lbs" explanationKey="hwEoLauncher" />
                    <Row label='Rocket "Pigeon" launcher' k="hwRocketM261" step={1} unit="lbs" explanationKey="hwRocketM261" />
                  </>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => { setSettings(D); setPendingSet(D); setSettingsReset(r => r + 1); setShowSettings(false); setConfirmStep(0) }}
                    style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10, color: t.text3 }}>
                    ↺ RESET
                  </button>
                  <button onClick={() => { setShowSettings(false); setConfirmStep(0) }}
                    style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10 }}>
                    CANCEL
                  </button>
                  <button onClick={() => setConfirmStep(1)} disabled={!anyModified}
                    style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10,
                      color: anyModified ? t.accent : t.text3,
                      borderColor: anyModified ? t.accent : t.border0,
                      cursor: anyModified ? 'pointer' : 'default' }}>
                    APPLY →
                  </button>
                </div>
              </>)}

              {confirmStep === 1 && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 13, color: t.warn, marginBottom: 10, fontWeight: 700 }}>⚠ CONFIRM CHANGE</div>
                  <div style={{ fontSize: 11, color: t.text1, marginBottom: 6 }}>
                    Modifying {Object.keys(D).filter(k => pendingSet[k] !== D[k]).length} parameter(s).
                  </div>
                  <div style={{ fontSize: 10, color: t.text2, marginBottom: 20 }}>These values affect flight calculations. Are you sure?</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={() => setConfirmStep(0)} style={{ ...iconBtnStyle, padding: '6px 18px' }}>← BACK</button>
                    <button onClick={() => setConfirmStep(2)} style={{ ...iconBtnStyle, padding: '6px 18px', color: t.warn, borderColor: t.warn }}>CONFIRM →</button>
                  </div>
                </div>
              )}

              {confirmStep === 2 && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 13, color: t.warn, marginBottom: 10, fontWeight: 700 }}>⚠ FINAL CONFIRMATION</div>
                  <div style={{ fontSize: 11, color: t.text1, marginBottom: 6 }}>Non-default values override system calibration data.</div>
                  <div style={{ fontSize: 10, color: t.caution, marginBottom: 20, fontWeight: 700 }}>Last chance to cancel.</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={() => setConfirmStep(1)} style={{ ...iconBtnStyle, padding: '6px 18px' }}>← BACK</button>
                    <button onClick={() => { setSettings(pendingSet); setShowSettings(false); setConfirmStep(0) }}
                      style={{ ...iconBtnStyle, padding: '6px 18px', color: t.warn, borderColor: t.warn, background: t.bg4 }}>
                      ✓ APPLY NOW
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── UTM entry modal ── */}
      {showUtmModal && (
        <UtmEntryModal
          onClose={() => setShowUtmModal(false)}
          onConfirm={wpts => {
            updateRoute(activeRouteId, r => ({ ...r, waypoints: wpts, results: null }))
            setShowUtmModal(false)
          }}
          aglOffset={parseInt(aglOffset) || 1000}
          defaultSpeed={120}
          defaultOat={25}
          defaultOatAuto={true}
        />
      )}

      {/* ── Notes panel — Wind analysis & Bingo calculator ── */}
      {showNotes && (
        <NotesPanel
          routes={routes}
          settings={settings}
          bingoTargetMode={bingoTargetMode}
          onRequestMapClick={() => setBingoTargetMode(true)}
          onCancelMapClick={() => setBingoTargetMode(false)}
          pendingBingoTarget={pendingBingoTarget}
          onBingoTargetConsumed={() => setPendingBingoTarget(null)}
          onClose={() => { setShowNotes(false); setBingoTargetMode(false); setPendingBingoTarget(null) }}
        />
      )}

      {/* ── Stop alert banner — shown when mid-leg WCA halted the calculation ── */}
      {stopAlert && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 5000, fontFamily: t.font,
          background: stopAlert.level === 'WARNING' ? '#7f1d1d' : '#78350f',
          border: `2px solid ${stopAlert.level === 'WARNING' ? '#ef4444' : '#facc15'}`,
          borderRadius: 6, padding: '8px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          maxWidth: 500,
        }}>
          <span style={{ fontSize: 16 }}>{stopAlert.level === 'WARNING' ? '⚠' : '◆'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
              color: stopAlert.level === 'WARNING' ? '#ef4444' : '#facc15' }}>
              CALCULATION STOPPED — {stopAlert.level}
            </div>
            <div style={{ fontSize: 11, color: '#e5e7eb', marginTop: 2 }}>{stopAlert.message}</div>
          </div>
          {suggestApplicable && (
            <button onClick={handleSuggestSpeed} style={{
              background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 4,
              color: '#93c5fd', cursor: 'pointer', fontSize: 10, fontWeight: 700,
              padding: '3px 8px', whiteSpace: 'nowrap', letterSpacing: 0.8,
            }}>SUGGEST SPEED</button>
          )}
          <button onClick={() => setStopAlert(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
            fontSize: 14, padding: '0 2px', lineHeight: 1,
          }}>✕</button>
        </div>
      )}

      {/* ── Suggest Speed: loading modal ── */}
      {suggestLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#0f1923', border: '2px solid #3b82f6', borderRadius: 12,
            padding: '36px 48px', textAlign: 'center', fontFamily: t.font,
            boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
          }}>
            <div style={{ fontSize: 32, letterSpacing: 4, fontWeight: 900, color: '#3b82f6', marginBottom: 4 }}>ILANA</div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: '#60a5fa', marginBottom: 28 }}>AH-64D MISSION PLANNER</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="48" height="48" viewBox="0 0 48 48" style={{ animation: 'spin 1.1s linear infinite' }}>
                <style>{'@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'}</style>
                <circle cx="24" cy="24" r="20" fill="none" stroke="#1e3a5f" strokeWidth="4"/>
                <path d="M24 4 A20 20 0 0 1 44 24" fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e7eb', letterSpacing: 2 }}>WORKING ON SUGGESTION</div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>Running binary search for optimal climb speed...</div>
          </div>
        </div>
      )}

      {/* ── Suggest Speed: result modal ── */}
      {suggestResult && !suggestLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#0f1923', border: `2px solid ${suggestResult.found ? '#3b82f6' : '#ef4444'}`,
            borderRadius: 12, padding: '28px 36px', fontFamily: t.font,
            boxShadow: '0 8px 40px rgba(0,0,0,0.8)', minWidth: 320, maxWidth: 420,
          }}>
            <div style={{ fontSize: 11, letterSpacing: 3, fontWeight: 700,
              color: suggestResult.found ? '#60a5fa' : '#f87171', marginBottom: 16 }}>
              {suggestResult.found ? 'SPEED SUGGESTION' : 'NO SUGGESTION AVAILABLE'}
            </div>
            {suggestResult.found ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 42, fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>
                    {suggestResult.suggested_tas_kts}
                  </span>
                  <span style={{ fontSize: 14, color: '#94a3b8' }}>kts TAS</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                  Maximum speed for WP{suggestResult.wptIdx + 1} without exceeding torque limits
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 20 }}>
                  Original speed: {Math.round(suggestResult.original_tas_kts)} kts
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => {
                    setWaypoints(wpts => wpts.map((w, i) =>
                      i === suggestResult.wptIdx ? { ...w, airspeed_kts: String(suggestResult.suggested_tas_kts) } : w
                    ))
                    setResults(null); setStopAlert(null); setSuggestResult(null)
                  }} style={{
                    flex: 1, background: '#1e3a5f', border: '1px solid #3b82f6',
                    borderRadius: 6, color: '#93c5fd', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, padding: '8px 0', letterSpacing: 1,
                  }}>ACCEPT & APPLY</button>
                  <button onClick={() => setSuggestResult(null)} style={{
                    flex: 1, background: '#1a1a2e', border: '1px solid #374151',
                    borderRadius: 6, color: '#9ca3af', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, padding: '8px 0', letterSpacing: 1,
                  }}>DISMISS</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#e5e7eb', marginBottom: 20 }}>
                  {suggestResult.message}
                </div>
                <button onClick={() => setSuggestResult(null)} style={{
                  width: '100%', background: '#1a1a2e', border: '1px solid #374151',
                  borderRadius: 6, color: '#9ca3af', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, padding: '8px 0', letterSpacing: 1,
                }}>CLOSE</button>
              </>
            )}
          </div>
        </div>
      )}

      {showWca && (() => {
        const D    = SETTINGS_DEFAULTS
        const setW = (k, v) => setPendingWca(p => ({ ...p, [k]: v }))
        const activeAlerts  = results?.alerts ?? []
        const wcaKeys       = Object.keys(D).filter(k => k.startsWith('wca'))
        const anyModified   = wcaKeys.some(k => pendingWca[k] !== D[k])
        const tabModified   = lv => [
          ...lv.params.map(p => p.k),
          ...lv.params.filter(p => p.enableKey).map(p => p.enableKey),
        ].some(k => pendingWca[k] !== D[k])
        const resetTab      = lv => {
          const patch = {}
          lv.params.forEach(p => {
            patch[p.k] = D[p.k]
            if (p.enableKey) patch[p.enableKey] = D[p.enableKey]
          })
          setPendingWca(p => ({ ...p, ...patch }))
        }

        // Config per level: [enableKey, icon, colorKey, label, description, params]
        const LEVELS = [
          {
            level: 'WARNING', icon: '⚠', color: t.warn,
            enableKey: 'wcaWarningsEnabled', noDisable: true,
            desc: 'Critical safety violations — always active',
            params: [
              { label: 'ΔTorque limit', k: 'wcaWarnDeltaTorque',  step: 0.5,  unit: '%',   explanationKey: 'DELTA_TORQUE' },
              { label: 'Cruise torque',     k: 'wcaWarnCruiseTorque', step: 0.5,  unit: '%',   explanationKey: 'CRUISE_TORQUE' },
              { label: 'Fuel minimum',      k: 'wcaWarnMinFuel',      step: 50,   unit: 'lbs', explanationKey: 'FUEL_MINIMUM' },
              { label: 'Max gross weight',  k: 'wcaWarnMaxGw',        step: 100,  unit: 'lbs', explanationKey: 'MAX_GROSS_WEIGHT' },
            ],
          },
          {
            level: 'CAUTION', icon: '◆', color: t.caution,
            noDisable: true,
            desc: 'Operational limit violations — yellow indicator',
            params: [
              { label: 'ΔTorque limit',      k: 'wcaCautionDeltaTorque',  step: 0.5, unit: '%', enableKey: 'wcaCautionDeltaTorqueEnabled', explanationKey: 'DELTA_TORQUE' },
              { label: 'Cruise torque',       k: 'wcaCautionCruiseTorque', step: 0.5, unit: '%', enableKey: 'wcaCautionCruiseTorqueEnabled', explanationKey: 'CRUISE_TORQUE' },
              { label: 'Terrain margin', k: 'wcaCautionTerrainMargin', step: 50, unit: 'ft', enableKey: 'wcaCautionTerrainEnabled',
                desc: 'Alert if terrain exceeds leg path by this margin', explanationKey: 'TERRAIN_MARGIN' },
            ],
          },
          {
            level: 'ADVISORY', icon: 'ℹ', color: t.accent,
            noDisable: true,
            desc: 'Informational — blue indicator, non-blocking',
            params: [
              { label: 'ΔTorque limit', k: 'wcaAdvisoryDeltaTorque',  step: 0.5, unit: '%',   enableKey: 'wcaAdvisoryDeltaTorqueEnabled', explanationKey: 'DELTA_TORQUE' },
              { label: 'Cruise torque', k: 'wcaAdvisoryCruiseTorque', step: 0.5, unit: '%',   enableKey: 'wcaAdvisoryCruiseTorqueEnabled', explanationKey: 'CRUISE_TORQUE' },
              { label: 'Fuel minimum',  k: 'wcaAdvisoryMinFuel',      step: 50,  unit: 'lbs', enableKey: 'wcaAdvisoryFuelEnabled', explanationKey: 'FUEL_MINIMUM' },
            ],
          },
        ]

        const active = LEVELS.find(l => l.level === wcaTab) ?? LEVELS[0]
        const { level, icon, color, enableKey, desc, params, noDisable } = active
        const enabled    = noDisable ? true : pendingWca[enableKey]
        const alertCount = activeAlerts.filter(a => a.level === level).length

        return (
          <div onClick={() => setShowWca(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: t.bg1, border: `1px solid ${t.border1}`,
              borderRadius: 8, width: 400, fontFamily: t.font, overflow: 'hidden',
            }}>

              {/* Header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', borderBottom: `1px solid ${t.border0}`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.warn, letterSpacing: 3 }}>⚠ WCA CONFIG</span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {anyModified && <span style={{ fontSize: 9, color: t.caution, letterSpacing: 1 }}>● MODIFIED</span>}
                  <span style={{ fontSize: 9, color: t.text3 }}>
                    {activeAlerts.length === 0 ? 'no active alerts' : `${activeAlerts.length} alert${activeAlerts.length > 1 ? 's' : ''}`}
                  </span>
                </div>
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: `1px solid ${t.border0}` }}>
                {LEVELS.map(lv => {
                  const isActive  = lv.level === wcaTab
                  const lvAlerts  = activeAlerts.filter(a => a.level === lv.level).length
                  return (
                    <button key={lv.level} onClick={() => setWcaTab(lv.level)} style={{
                      flex: 1, padding: '10px 4px', cursor: 'pointer', fontFamily: t.font,
                      fontSize: 9, fontWeight: 700, letterSpacing: 1,
                      border: 'none', borderBottom: isActive ? `2px solid ${lv.color}` : '2px solid transparent',
                      background: isActive ? lv.color + '18' : 'transparent',
                      color: isActive ? lv.color : t.text2,
                      transition: 'all 0.15s',
                    }}>
                      {lv.icon} {lv.level}
                      {tabModified(lv) && <span style={{ marginLeft: 4, color: t.caution }}>●</span>}
                      {lvAlerts > 0 && (
                        <span style={{
                          marginLeft: 5, fontSize: 8, padding: '1px 5px',
                          borderRadius: 8, background: lv.color + '30', color: lv.color,
                        }}>{lvAlerts}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Active panel */}
              <div style={{ padding: '0 0 4px', opacity: enabled ? 1 : 0.55, transition: 'opacity 0.15s' }}>

                {/* Panel header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', background: enabled ? color + '12' : t.bg2,
                }}>
                  <span style={{ fontSize: 14, color: enabled ? color : t.text3 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: t.text3 }}>{desc}</div>
                  </div>
                  {tabModified(active) && (
                    <button onClick={() => resetTab(active)} style={{
                      padding: '3px 8px', fontSize: 8, fontWeight: 700,
                      cursor: 'pointer', fontFamily: t.font, borderRadius: 3,
                      background: 'transparent', border: `1px solid ${t.border0}`,
                      color: t.caution,
                    }}>↺ RESET</button>
                  )}
                  {level === 'WARNING' && (
                    <span style={{
                      padding: '3px 10px', fontSize: 8, fontWeight: 700,
                      borderRadius: 3, border: `1px solid ${color}`,
                      background: color + '25', color,
                    }}>ALWAYS ON</span>
                  )}
                </div>

                {/* Parameter rows */}
                <div style={{ background: t.bg0, padding: '4px 16px 8px' }}>
                  {params.map(({ label, k, step, unit, enableKey: rowEnableKey, noValue, desc: rowDesc, explanationKey }) => {
                    const rowEnabled = rowEnableKey ? pendingWca[rowEnableKey] : true
                    const modified   = (k && pendingWca[k] !== D[k]) || (rowEnableKey && pendingWca[rowEnableKey] !== D[rowEnableKey])
                    return (
                      <div key={rowEnableKey ?? k} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 0', borderBottom: `1px solid ${t.border0}`,
                        opacity: rowEnabled ? 1 : 0.45,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {rowEnableKey && (
                            <button onClick={() => setW(rowEnableKey, !rowEnabled)} style={{
                              width: 28, fontSize: 8, fontWeight: 700, cursor: 'pointer',
                              fontFamily: t.font, borderRadius: 3, padding: '2px 0', textAlign: 'center',
                              background: rowEnabled ? color + '25' : t.bg3,
                              border: `1px solid ${rowEnabled ? color : t.border0}`,
                              color: rowEnabled ? color : t.text3,
                            }}>{rowEnabled ? 'ON' : 'OFF'}</button>
                          )}
                          <div>
                            <span title={explanationKey ? get(explanationKey) : ''} style={{ fontSize: 10, color: modified ? color : t.text2, cursor: explanationKey ? 'help' : 'default' }}>
                              {label}{modified ? ' ●' : ''}
                            </span>
                            {rowDesc && <div style={{ fontSize: 8, color: t.text3, marginTop: 1 }}>{rowDesc}</div>}
                          </div>
                        </div>
                        {!noValue && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <input
                            key={`${k}-${pendingWca[k]}`}
                            type="number" step={step} defaultValue={pendingWca[k]}
                            disabled={!rowEnabled}
                            onBlur={e => {
                              const n = parseFloat(e.target.value)
                              if (!isNaN(n)) setW(k, n); else e.target.value = pendingWca[k]
                            }}
                            style={{
                              width: 70, background: t.bg3,
                              border: `1px solid ${modified && rowEnabled ? color : t.border0}`,
                              borderRadius: 3, padding: '3px 6px',
                              color: modified && rowEnabled ? color : t.text0,
                              fontSize: 11, fontFamily: t.font, textAlign: 'right', outline: 'none',
                              cursor: rowEnabled ? 'text' : 'not-allowed',
                            }}
                          />
                          <span style={{ fontSize: 9, color: t.text3, width: 32 }}>{unit}</span>
                        </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, padding: '8px 16px 14px' }}>
                <button onClick={() => setPendingWca(D)}
                  style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10, color: t.text3 }}>
                  ↺ RESET
                </button>
                <button onClick={() => setShowWca(false)}
                  style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10 }}>
                  CANCEL
                </button>
                <button onClick={() => { setSettings(s => ({ ...s, ...pendingWca })); setShowWca(false) }}
                  style={{ ...iconBtnStyle, flex: 1, padding: '6px 0', fontSize: 10,
                           color: t.accent, borderColor: t.accent }}>
                  APPLY
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Export route selector modal ── */}
      {showExportModal && (
        <div onClick={() => setShowExportModal(null)} style={{
          position: 'fixed', inset: 0, background: '#00000099', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.bg1, border: `2px solid ${t.accent}`, borderRadius: 8,
            padding: '24px 28px', minWidth: 300, fontFamily: t.font,
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: t.accent, letterSpacing: 2, marginBottom: 16 }}>
              {showExportModal === 'excel' ? '⬇ EXPORT EXCEL' : '⬇ EXPORT / PRINT'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: t.text2, letterSpacing: 1 }}>SELECT ROUTES TO EXPORT:</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setExportRouteIds(new Set(routes.filter(r => r.results).map(r => r.id)))}
                  style={{ ...iconBtnStyle, padding: '2px 8px', fontSize: 9 }}>ALL</button>
                <button onClick={() => setExportRouteIds(new Set())}
                  style={{ ...iconBtnStyle, padding: '2px 8px', fontSize: 9 }}>NONE</button>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              {routes.map(r => {
                const checked = exportRouteIds.has(r.id)
                const disabled = !r.results
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      if (disabled) return
                      setExportRouteIds(prev => {
                        const next = new Set(prev)
                        if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                        return next
                      })
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 4,
                      cursor: disabled ? 'default' : 'pointer',
                      background: checked ? t.bg4 : 'transparent',
                      border: `1px solid ${checked ? r.color : 'transparent'}`,
                      marginBottom: 3, opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    <input type="checkbox" checked={checked} readOnly disabled={disabled}
                      style={{ accentColor: r.color, cursor: disabled ? 'default' : 'pointer' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, color: checked ? t.text0 : t.text2, fontWeight: checked ? 700 : 400 }}>
                      {r.name}
                    </span>
                    {disabled && <span style={{ fontSize: 9, color: t.warn }}>calculate first</span>}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowExportModal(null)} style={{ ...iconBtnStyle, padding: '6px 16px', fontSize: 10 }}>
                CANCEL
              </button>
              <button
                disabled={exportRouteIds.size === 0}
                title={exportRouteIds.size === 0 ? 'Select at least one route' : ''}
                onClick={async () => {
                  const selected = routes.filter(r => exportRouteIds.has(r.id) && r.results)
                  if (selected.length === 0) return
                  if (showExportModal === 'excel') {
                    const result = exportExcel(selected.map(r => ({ results: r.results, routeName: r.name, waypoints: r.waypoints, ...routeExportProps(r) })), projectName)
                    await saveFileWithDialog(result.blob, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                  } else {
                    exportFlightTable(selected.map(r => { const ep = routeExportProps(r); return { results: r.results, routeName: r.name, variant: ep.variant, emptyWt: ep.emptyWt, initFuel: ep.initFuel, waypoints: r.waypoints } }))
                  }
                  setShowExportModal(null)
                }}
                style={{ ...iconBtnStyle, padding: '6px 16px', fontSize: 10,
                  opacity: exportRouteIds.size === 0 ? 0.4 : 1 }}>
                EXPORT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Icon sidebar (always visible) ───────────────────────────────── */}
      <div style={{
        width: 54, flexShrink: 0, background: t.bg0,
        borderRight: `1px solid ${t.border0}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 8, paddingBottom: 8, gap: 3,
      }}>
        {/* Logo — triple-click to open easter egg */}
        <div
          onClick={() => {
            const lc = logoClickRef.current
            clearTimeout(lc.timer)
            lc.count++
            if (lc.count >= 3) { lc.count = 0; setShowEasterEgg(true) }
            else lc.timer = setTimeout(() => { lc.count = 0 }, 1400)
          }}
          title="ILANA · Apache Mission Planner"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginBottom: 6, cursor: 'pointer' }}
        >
          <img src="/logo.png" alt="ILANA" style={{
            width: 40, height: 40, objectFit: 'contain', borderRadius: 8,
            border: `1px solid ${t.border1}`,
            background: t.bg2,
          }} />
          <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 3, color: t.accent, fontFamily: t.font }}>ILANA</span>
        </div>

        {/* File group */}
        <SideBtn icon="+" label="NEW"    tip="New mission"               onClick={() => setShowNewConfirm(true)} t={t} />
        <SideBtn icon="↑" label="LOAD"   tip="Load mission (.json)"      onClick={() => setShowLoadConfirm('json')} t={t} />
        <SideBtn icon="⇑" label="XLS IN" tip="Load from Excel"           onClick={() => setShowLoadConfirm('xls')} t={t} />
        <SideBtn icon="↓" label="SAVE"   tip="Save mission (.json)"      onClick={exportMission} t={t} />

        <SideSep t={t} />

        {/* Config group */}
        <SideBtn icon="⚙" label="SET" tip="Settings"
          onClick={() => { setPendingSet(settings); setConfirmStep(0); setShowSettings(true) }} t={t} />

        {/* WCA button — color tracks highest active alert severity */}
        {(() => {
          const activeAlerts = results?.alerts ?? []
          const wcaColor = results?.has_warnings        ? t.warn
                         : results?.has_active_cautions ? t.caution
                         : activeAlerts.some(a => a.level === 'ADVISORY') ? t.accent
                         : t.text2
          const wcaBorder = wcaColor === t.text2 ? t.border0 : wcaColor
          const topAlert  = results?.has_warnings ? 'W' : results?.has_active_cautions ? 'C'
                          : activeAlerts.some(a => a.level === 'ADVISORY') ? 'A' : null
          return (
            <button
              onClick={() => { setPendingWca(settings); setWcaTab('WARNING'); setShowWca(true) }}
              title="Warnings / Cautions / Advisories"
              style={{
                width: 46, height: 46, background: 'none', flexShrink: 0,
                border: `1px solid ${wcaBorder}`,
                borderRadius: 6, cursor: 'pointer', color: wcaColor,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 2, fontFamily: t.font, transition: 'all 0.12s', position: 'relative',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = t.bg2; e.currentTarget.style.borderColor = wcaColor === t.text2 ? t.accent : wcaColor }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = wcaBorder }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
              <span style={{ fontSize: 8, letterSpacing: 0.5, fontWeight: 700 }}>WCA</span>
              {topAlert && (
                <span style={{
                  position: 'absolute', top: 3, right: 3, width: 11, height: 11,
                  borderRadius: '50%', background: wcaColor,
                  fontSize: 7, fontWeight: 900, color: t.bg0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{topAlert}</span>
              )}
            </button>
          )
        })()}

        <SideSep t={t} />

        {/* Info group */}
        <SideBtn icon="✎" label="NOTES" tip="Notes"          onClick={() => setShowNotes(true)} t={t} />
        <SideBtn icon="?" label="HELP"  tip="Help"           onClick={() => setShowHelp(true)} t={t} />
        <SideBtn icon="ℹ" label="ABOUT" tip="About ILANA"   onClick={() => setShowAbout(true)} t={t} />

        {/* Push theme toggle to bottom */}
        <div style={{ flex: 1 }} />

        <SideSep t={t} />
        <SideBtn icon="◑" label={themeName === 'blue' ? 'GREEN' : themeName === 'green' ? 'LIGHT' : 'BLUE'}
          tip={`Switch to ${themeName === 'blue' ? 'Dark Green' : themeName === 'green' ? 'Light' : 'Dark Blue'}`}
          onClick={toggle} t={t} />

        <input ref={importRef}    type="file" accept=".json"        onChange={importMission}    style={{ display: 'none' }} />
        <input ref={importXlsRef} type="file" accept=".xlsx,.xls"  onChange={importMissionXls} style={{ display: 'none' }} />
      </div>

      {/* ── Left panel (collapsible) ─────────────────────────────────────── */}
      {!leftFolded && (
      <div style={{
        width: leftWidth, minWidth: 280, background: t.bg1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${t.border0}`, background: t.bg0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 4, color: t.accent }}>ILANA</div>
            <div style={{ fontSize: 10, color: t.text2, letterSpacing: 3, fontWeight: 600 }}>APACHE · MISSION PLANNER</div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: t.text3, letterSpacing: 1 }}>ROUTE</span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: activeRoute.color,
                background: t.bg3, border: `1px solid ${activeRoute.color}`,
                borderRadius: 3, padding: '2px 8px', letterSpacing: 1, maxWidth: 120,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{activeRoute.name}</span>
            </div>
          </div>
        </div>

        {/* ── Scrollable content area ───────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── AIRCRAFT ──────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${t.border0}` }}>
          <div onClick={() => setAcftExpanded(e => !e)} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg2, borderLeft: acftExpanded ? `3px solid ${t.accent}` : '3px solid transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: acftExpanded ? t.text0 : t.text2, letterSpacing: 2 }}>AIRCRAFT</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!acftExpanded && <>{badge(VARIANT_LABEL[variant] || variant, t.accent)} {badge(`ETF ${acft}`, t.text2)}</>}
              <span style={{ fontSize: 11, color: t.text3 }}>{acftExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {acftExpanded && (
            <div style={{ padding: '8px 16px', background: t.bg3 }}>
              <Row label="VARIANT" t={t}>
                <select value={variant} onChange={e => setVariant(e.target.value)} style={inputStyle}>
                  <option value="LB">AH-64D — SARAF</option>
                  <option value="peten">AH-64A — PETEN</option>
                </select>
              </Row>
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 9, color: t.text3, marginBottom: 4, letterSpacing: 2 }}>701C TORQUE FACTOR</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: t.text3, marginBottom: 2 }}>ENG1</div>
                    <input value={etfEng1} onChange={e => setEtfEng1(e.target.value)} placeholder="0.95" style={validStyle(etfEng1, 0.8, 1.0, sectionInputStyle)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: t.text3, marginBottom: 2 }}>ENG2</div>
                    <input value={etfEng2} onChange={e => setEtfEng2(e.target.value)} placeholder="0.95" style={validStyle(etfEng2, 0.8, 1.0, sectionInputStyle)} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: t.text3, marginBottom: 2 }}>ACFT</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.accent, letterSpacing: 1 }}>{acft}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── WING STORES ───────────────────────────────────────────────── */}
        <WingStoresPanel
          initialStations={stationsConfig}
          initialFcrOn={fcrOn}
          initialCompodOn={compodOn}
          onAtfChange={setGlobalAtf}
          onStationsChange={setStationsConfig}
          variant={variant}
          gunAmmo={gunAmmo} onGunAmmoChange={setGunAmmo}
          hfMissiles={hfMissiles}     onHfMissilesChange={setHfMissiles}
          eoMissiles={eoMissiles}     onEoMissilesChange={setEoMissiles}
          rocketRounds={rocketRounds} onRocketRoundsChange={setRocketRounds}
          onFcrChange={setFcrOn}
          onCompodChange={setCompodOn}
          fcrDeltaF={settings.fcrDeltaF}
          compodDeltaF={settings.compodDeltaF}
          storeDfSettings={settings}
        />

        {/* ── WEIGHT ────────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${t.border0}` }}>
          <div onClick={() => setWeightExpanded(e => !e)} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg2, borderLeft: weightExpanded ? `3px solid ${t.accent}` : '3px solid transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: weightExpanded ? t.text0 : t.text2, letterSpacing: 2 }}>WEIGHT</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!weightExpanded && badge(`GW ${Math.round(grossWt).toLocaleString()} LBS`, gwColor)}
              <span style={{ fontSize: 11, color: t.text3 }}>{weightExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {weightExpanded && (
            <div style={{ padding: '8px 16px', background: t.bg3 }}>
              <Row label="BASE EMPTY WT (LBS)" t={t}>
                <input value={baseEmptyWt} onChange={e => setBaseEmptyWt(e.target.value)} placeholder="13200" style={validStyle(baseEmptyWt, 10000, 16000)} />
              </Row>
              <Row label="OTHER (LBS)" t={t}>
                <input value={otherWt} onChange={e => setOtherWt(e.target.value)} placeholder="0" style={validStyle(otherWt, 0, 1000)} />
              </Row>
              <Row label="INIT FUEL (LBS)" t={t}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={initFuel} onChange={e => setInitFuel(e.target.value)} placeholder="2500" style={validStyle(initFuel, 0, maxFuel)} />
                  <span style={{ fontSize: 9, color: (() => { const num = parseFloat(initFuel); return initFuel !== '' && !isNaN(num) && (num < 0 || num > maxFuel) ? t.warn : t.text3 })() }}>max {maxFuel}</span>
                </div>
              </Row>

              {/* Weight breakdown */}
              <div style={{ marginTop: 8, background: t.bg2, borderRadius: 4, border: `1px solid ${t.border0}` }}>
                <div onClick={() => setWtBkExpanded(e => !e)} style={{ padding: '6px 10px', cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: t.text3, letterSpacing: 2 }}>WEIGHT BREAKDOWN</span>
                  <span style={{ fontSize: 9, color: t.text3 }}>{wtBkExpanded ? '▲' : '▼'}</span>
                </div>
                {wtBkExpanded && (
                  <div style={{ padding: '0 10px 8px' }}>
                    <WtRow label="Airframe"       value={parseFloat(baseEmptyWt) || 13200} t={t} />
                    <WtRow label="Crew"           value={settings.crewWtDefault} t={t} />
                    <WtRow label="Chaff & Flare"  value={settings.chaffFlareWtDefault} t={t} />
                    {(parseFloat(otherWt)||0) > 0 && <WtRow label="Other" value={parseFloat(otherWt)} t={t} />}
                    {storesHwWt > 0            && <WtRow label="Stores HW"  value={storesHwWt} t={t} />}
                    {gunAmmoWt  > 0            && <WtRow label="30mm ammo"  value={gunAmmoWt}  t={t} />}
                    {(parseInt(hfMissiles)  ||0)>0 && <WtRow label={`AGM-114 ×${hfMissiles}`}  value={(parseInt(hfMissiles)||0)*settings.hellfireWt} t={t} />}
                    {(parseInt(eoMissiles)  ||0)>0 && <WtRow label={`EO msls ×${eoMissiles}`}   value={(parseInt(eoMissiles)||0)*settings.eoMissileWt} t={t} />}
                    {(parseInt(rocketRounds)||0)>0 && <WtRow label={`Rockets ×${rocketRounds}`} value={(parseInt(rocketRounds)||0)*settings.rocketRoundWt} t={t} />}
                    {fcrWt   > 0 && <WtRow label="FCR"    value={fcrWt}   t={t} />}
                    {compodWt > 0 && <WtRow label="COMPOD" value={compodWt} t={t} />}
                    <div style={{ borderTop: `1px solid ${t.border0}`, marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: t.text2, letterSpacing: 1 }}>CONFIG WT</span>
                      <span style={{ fontWeight: 700, color: t.accent }}>{configuredEmptyWt.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 2 }}>
                      <span style={{ color: t.text3 }}>+ Fuel</span>
                      <span style={{ color: t.text2 }}>{(parseFloat(initFuel)||0).toLocaleString()}</span>
                    </div>
                    <div style={{ borderTop: `1px solid ${t.border1}`, marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: t.text0, letterSpacing: 1 }}>GROSS WT</span>
                      <span style={{ fontWeight: 700, color: gwColor }}>{Math.round(grossWt).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── NAVIGATION ────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${t.border0}` }}>
          <div onClick={() => setNavExpanded(e => !e)} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg2, borderLeft: navExpanded ? `3px solid ${t.accent}` : '3px solid transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: navExpanded ? t.text0 : t.text2, letterSpacing: 2 }}>NAVIGATION</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!navExpanded && <>{badge(`${altMode} ${aglOffset || 1000} FT`, t.accent)} {badge(`ISA ${seaLevelTemp || 25}°C`, t.text2)}</>}
              <span style={{ fontSize: 11, color: t.text3 }}>{navExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {navExpanded && (
            <div style={{ padding: '8px 16px', background: t.bg3 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {['AGL', 'MSL'].map(mode => (
                  <button key={mode} onClick={() => setAltMode(mode)} title={get(mode)} style={{
                    flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 700,
                    letterSpacing: 1, borderRadius: 3, cursor: 'pointer', fontFamily: t.font,
                    background: altMode === mode ? t.bg4 : t.bg2,
                    color: altMode === mode ? t.text0 : t.text2,
                    border: `1px solid ${altMode === mode ? t.border1 : t.border0}`,
                  }}>{mode}</button>
                ))}
              </div>
              <Row label={altMode === 'AGL' ? 'DEFAULT AGL (FT)' : 'DEFAULT ALT MSL (FT)'} t={t}>
                <input value={aglOffset} onChange={e => setAglOffset(e.target.value)} placeholder="1000" style={validStyle(aglOffset, 0, 12000)} />
              </Row>
              <div style={{ fontSize: 9, color: t.text3, marginBottom: 6, fontStyle: 'italic' }}>
                {altMode === 'AGL' ? 'Alt = DSM + AGL offset' : 'Alt = MSL value (DSM shown for reference only)'}
              </div>
              <Row label="SEA LEVEL TEMP (°C)" t={t}>
                <input value={seaLevelTemp} onChange={e => setSeaLevelTemp(e.target.value)} placeholder="25" style={validStyle(seaLevelTemp, -15, 50)} />
              </Row>
              <div style={{ fontSize: 9, color: t.text3, marginBottom: 8, fontStyle: 'italic' }}>
                OAT auto-computed via ELR 1.98°C/1000ft — edit per-waypoint to override
              </div>
              <button onClick={applyAglToAll} style={{ ...iconBtnStyle, width: '100%', padding: '5px 0', fontSize: 10 }}>
                UPDATE ALL WAYPOINTS
              </button>
            </div>
          )}
        </div>

        {/* ── WIND ──────────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${t.border0}` }}>
          <div onClick={() => setWindExpanded(e => !e)} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg2, borderLeft: windExpanded ? `3px solid ${t.accent}` : '3px solid transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: windExpanded ? t.text0 : t.text2, letterSpacing: 2 }}>WIND</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!windExpanded && <>{badge(windPreset === 'fixed' ? `${windPresetDir}° / ${windPresetSpeed}KT` : `${windPreset.toUpperCase()} ${windPresetSpeed}KT`, t.accent)}</>}
              <span style={{ fontSize: 11, color: t.text3 }}>{windExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {windExpanded && (
            <div style={{ padding: '10px 16px', background: t.bg3 }}>
              {/* Mode selector */}
              <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2, marginBottom: 6 }}>WIND MODE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 10 }}>
                {[
                  ['fixed', 'FIXED', 'FIXED'],
                  ['nose',  'HEADWIND', 'HEADWIND'],
                  ['back',  'TAILWIND', 'TAILWIND'],
                  ['right', 'RIGHT CROSS', 'RIGHT_CROSS'],
                  ['left',  'LEFT CROSS',  'LEFT_CROSS'],
                ].map(([mode, label, explanationKey]) => (
                  <button key={mode} onClick={() => setWindPreset(mode)} title={get(explanationKey)} style={{
                    padding: '5px 4px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                    borderRadius: 3, cursor: 'pointer', fontFamily: t.font,
                    background: windPreset === mode ? t.bg5 : t.bg2,
                    color: windPreset === mode ? t.accent : t.text2,
                    border: `1px solid ${windPreset === mode ? t.accent : t.border0}`,
                    gridColumn: mode === 'fixed' ? '1 / -1' : undefined,
                  }}>{label}</button>
                ))}
              </div>

              {/* Inputs */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
                {windPreset === 'fixed' && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: t.text3, marginBottom: 3, letterSpacing: 1 }}>FROM DIR °</div>
                    <input type="number" min="0" max="360" value={windPresetDir}
                      onChange={e => setWindPresetDir(e.target.value)}
                      style={validStyle(windPresetDir, 0, 360)} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: t.text3, marginBottom: 3, letterSpacing: 1 }}>SPEED KTS</div>
                  <input type="number" min="0" max="50" value={windPresetSpeed}
                    onChange={e => setWindPresetSpeed(e.target.value)}
                    style={validStyle(windPresetSpeed, 0, 50)} />
                </div>
              </div>

              {/* Description */}
              <div style={{ fontSize: 9, color: t.text3, fontStyle: 'italic', marginBottom: 8, lineHeight: 1.5 }}>
                {windPreset === 'fixed'  && `All waypoints: wind FROM ${windPresetDir}° at ${windPresetSpeed} KTS`}
                {windPreset === 'nose'   && `Headwind: auto wind direction = leg bearing (FROM nose). Reduces ground speed.`}
                {windPreset === 'back'   && `Tailwind: auto wind direction = leg bearing +180° (FROM tail). Increases ground speed.`}
                {windPreset === 'right'  && `Right crosswind: auto wind direction = leg bearing +90°. From the right side.`}
                {windPreset === 'left'   && `Left crosswind: auto wind direction = leg bearing +270°. From the left side.`}
              </div>

              <button onClick={applyWindPreset} style={{ ...iconBtnStyle, width: '100%', padding: '5px 0', fontSize: 10 }}>
                APPLY TO ROUTE
              </button>
            </div>
          )}
        </div>

        {/* ── WAYPOINTS ─────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${t.border0}` }}>
          <div onClick={() => setWptExpanded(e => !e)} style={{ padding: '10px 16px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg2, borderLeft: wptExpanded ? `3px solid ${t.accent}` : '3px solid transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: wptExpanded ? t.text0 : t.text2, letterSpacing: 2 }}>WAYPOINTS</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {!wptExpanded && badge(`${waypoints.length} PTS`, t.accent)}
              <span style={{ fontSize: 11, color: t.text3 }}>{wptExpanded ? '▲' : '▼'}</span>
            </div>
          </div>
          {wptExpanded && (
            <div style={{ padding: '8px 0' }}>
              {waypoints.length === 0 && (
                <div style={{ padding: '10px 16px 6px' }}>
                  <div style={{ fontSize: 11, color: t.text3, marginBottom: 8, letterSpacing: 1 }}>
                    ADD WAYPOINTS VIA:
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { icon: '✎', label: 'Manual UTM',    onClick: () => setShowUtmModal(true) },
                      { icon: '📊', label: 'Galaxy XLS',    onClick: () => fileImportRef.current?.click() },
                      { icon: '📁', label: 'Einat .ENT',    onClick: () => entImportRef.current?.click() },
                      { icon: '🗺', label: 'From Map',      onClick: () => setMapAddMode(true) },
                    ].map(({ icon, label, onClick }) => (
                      <button key={label} onClick={onClick}
                        style={{
                          flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', fontFamily: t.font, borderRadius: 4, textAlign: 'center',
                          background: t.bg3, border: `1px solid ${t.border1}`, color: t.text1,
                        }}>
                        <div style={{ fontSize: 14, marginBottom: 3 }}>{icon}</div>
                        {label}
                      </button>
                    ))}
                  </div>
                  {fileImportStatus && !fileImportStatus.startsWith('✔') && (
                    <div style={{ marginTop: 6, fontSize: 9, color: t.accent, fontStyle: 'italic' }}>
                      {fileImportStatus}
                    </div>
                  )}
                  {fileImportError && (
                    <div style={{ marginTop: 4, fontSize: 9, color: t.warn, fontStyle: 'italic' }}>
                      ⚠ {fileImportError}
                    </div>
                  )}
                  <input ref={fileImportRef} type="file" accept=".xls,.xlsx"
                    onChange={handleImportFile} style={{ display: 'none' }} />
                  <input ref={entImportRef} type="file" accept=".ent"
                    onChange={handleImportEnt} style={{ display: 'none' }} />
                </div>
              )}
              <WaypointPanel
                waypoints={waypoints} activeWpt={activeWpt}
                onSelect={setActiveWpt} onUpdate={updateWaypoint}
                onAdd={addWaypoint} onRemove={removeWaypoint}
                onReorder={reorderWaypoints} onReverse={reverseWaypoints}
                aglOffset={parseInt(aglOffset) || 1000}
                altMode={altMode}
                seaLevelTemp={parseFloat(seaLevelTemp) || 25}
                targetWptIdx={targetWptIdx} onSetTarget={handleSetTarget}
                cspWptIdx={cspWptIdx} cspFuel={cspFuel}
                onSetCsp={handleSetCsp}
                onCspFuelChange={setCspFuel}
                onCspAutoOge={val => handleCspAutoOge(val)}
                onCspAutoIge={val => handleCspAutoIge(val)}
                selectedWpts={selectedWpts}
                onSetSelectedWpts={setSelectedWpts}
              />
            </div>
          )}
        </div>

        </div>{/* end scrollable content */}

        {/* Calculate button */}
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${t.border0}` }}>
          {error && <div style={{ color: t.warn, fontSize: 11, marginBottom: 6 }}>{error}</div>}
          <button onClick={handleCalculate} disabled={loading || mapAddMode} style={btnStyle(loading || mapAddMode)}
            title={mapAddMode ? 'Click DONE on the map first' : ''}>
            {loading ? 'CALCULATING…' : mapAddMode ? 'FINISH MAP SELECTION FIRST' : 'CALCULATE FLIGHT PLAN'}
          </button>
          {/* Footer */}
          <div style={{ marginTop: 8, fontSize: 8, color: t.text3, textAlign: 'center', letterSpacing: 0.5 }}>
            v1.0.0 · 29 Mar 2026 · © 2006 Amit Bouzaglo
          </div>
        </div>
      </div>
      )} {/* end !leftFolded */}

      {/* ── Fold tab + resize handle (zero-width wrapper, overflows visibly) ── */}
      <div style={{ width: 0, flexShrink: 0, position: 'relative', zIndex: 500, visibility: tableFullscreen ? 'hidden' : 'visible' }}>
        {/* Resize handle — only when panel is open */}
        {!leftFolded && (
          <div
            onMouseDown={e => { leftDragRef.current = { startX: e.clientX, startWidth: leftWidth }; e.preventDefault() }}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = t.accent}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          />
        )}
        {/* Fold tab */}
        <div onClick={() => setLeftFolded(f => !f)} title={leftFolded ? 'Expand panel' : 'Collapse panel'}
          style={{
            position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 52,
            background: t.bg2, border: `1px solid ${t.border1}`, borderLeft: 'none',
            borderRadius: '0 8px 8px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: t.text2, fontSize: 10, transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = t.bg4; e.currentTarget.style.color = t.accent }}
          onMouseLeave={e => { e.currentTarget.style.background = t.bg2; e.currentTarget.style.color = t.text2 }}>
          {leftFolded ? '▶' : '◀'}
        </div>
      </div>

      {/* ── Map + results ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Map — has its own overflow:hidden so Leaflet is contained */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          <MapView waypoints={validWpts} results={results} activeWpt={activeWpt} onMapClick={onMapClick}
                   onMarkerClick={i => {
                     setActiveWpt(i)
                     setTimeout(() => document.querySelector(`[data-wpt-idx="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
                   }}
                   highlightedWptIdx={selectedWpt} highlightedLeg={selectedLeg}
                   selectedWpts={selectedWpts}
                   sizeKey={`${leftFolded}-${leftWidth}-${tableFolded}-${tableHeight}-${rightFolded}`}
                   bgRoutes={bgRoutes}
                   activeRouteColor={activeRoute.color}
                   opacity={mapOpacity / 100}
                   stopAlert={stopAlert}
                   alerts={results?.alerts ?? []}
                   addMode={mapAddMode}
                   tileMode={tileMode} />
          {mapAddMode && (
            <button onClick={() => setMapAddMode(false)} style={{
              position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
              zIndex: 1200, padding: '6px 20px', fontSize: 10, fontWeight: 700,
              fontFamily: 'monospace', letterSpacing: 1, cursor: 'pointer', borderRadius: 5,
              background: '#0ea5e9', border: '1.5px solid #38bdf8', color: '#fff',
            }}>✓ DONE — {waypoints.length} WAYPOINT{waypoints.length !== 1 ? 'S' : ''}</button>
          )}

          {bingoTargetMode && (
            <button onClick={() => setBingoTargetMode(false)} style={{
              position:'absolute', bottom:72, left:'50%', transform:'translateX(-50%)',
              zIndex:1200, padding:'6px 20px', fontSize:10, fontWeight:700,
              background:'#a855f7', border:'1.5px solid #c084fc', color:'#fff', borderRadius:5,
            }}>✕ CANCEL — PICKING BINGO TARGET</button>
          )}

          {/* ── Map overlay: route name + panel restore buttons ── */}
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, pointerEvents: 'none' }}>
            {/* Route name — always visible on map */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: t.bg0 + 'dd', borderRadius: 4, padding: '3px 9px',
              border: `1px solid ${activeRoute.color}`, pointerEvents: 'none',
              backdropFilter: 'blur(2px)',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: activeRoute.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: activeRoute.color, letterSpacing: 1 }}>{activeRoute.name}</span>
            </div>

          </div>

          {/* ── Map opacity slider ── */}
          <div style={{
            position: 'absolute', bottom: 24, right: 10, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 6,
            background: t.bg0 + 'cc', borderRadius: 4, padding: '4px 8px',
            border: `1px solid ${t.border0}`, backdropFilter: 'blur(2px)',
          }}>
            <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1, userSelect: 'none' }}>MAP</span>
            <input
              type="range" min={0} max={100} value={mapOpacity}
              onChange={e => setMapOpacity(Number(e.target.value))}
              style={{ width: 70, accentColor: t.accent, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 9, color: t.text3, width: 24, textAlign: 'right', userSelect: 'none' }}>{mapOpacity}%</span>
          </div>
        </div>

        {results && (
          <>
            {/* Fold tab + resize handle — zero-height, overflows up into map */}
            <div style={{ height: 0, flexShrink: 0, position: 'relative', zIndex: 500, visibility: tableFullscreen ? 'hidden' : 'visible' }}>
              {!tableFolded && (
                <div
                  onMouseDown={e => { tableDragRef.current = { startY: e.clientY, startHeight: tableHeight }; e.preventDefault() }}
                  style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, cursor: 'row-resize', background: 'transparent', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = t.accent}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                />
              )}
              <div onClick={() => setTableFolded(f => !f)} title={tableFolded ? 'Expand results' : 'Collapse results'}
                style={{
                  position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                  width: 52, height: 14,
                  background: t.bg2, border: `1px solid ${t.border1}`, borderBottom: 'none',
                  borderRadius: '8px 8px 0 0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: t.text2, fontSize: 9, transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = t.bg4; e.currentTarget.style.color = t.accent }}
                onMouseLeave={e => { e.currentTarget.style.background = t.bg2; e.currentTarget.style.color = t.text2 }}>
                {tableFolded ? '▲' : '▼'}
              </div>
            </div>

            {!tableFolded && (
              <div style={tableFullscreen ? {
                position: 'fixed', inset: 0, zIndex: 4000,
                display: 'flex', flexDirection: 'column', background: t.bg0,
              } : {
                height: tableHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '5px 12px 0', background: t.bg0, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 8, color: t.text3, letterSpacing: 1 }}>ROUTE</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: activeRoute.color,
                      background: t.bg3, border: `1px solid ${activeRoute.color}`,
                      borderRadius: 3, padding: '1px 7px', letterSpacing: 1, maxWidth: 140,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{activeRoute.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setTableFullscreen(f => !f)} style={iconBtnStyle}>
                      {tableFullscreen ? '⊟ EXIT' : '⊞ FULL'}
                    </button>
                    <button onClick={async () => {
                      if (routes.length === 1) {
                        const result = exportExcel([{ results, routeName: activeRoute.name, variant, emptyWt: configuredEmptyWt, initFuel, waypoints, baseEmptyWt, crewWt: settings.crewWtDefault, otherWt, storesHwWt, gunAmmoWt, missilesWt, gunAmmo, hfMissiles, eoMissiles, rocketRounds, stationsConfig, globalAtf, etfEng1, etfEng2 }], projectName)
                        await saveFileWithDialog(result.blob, result.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                      } else {
                        setExportRouteIds(new Set([activeRouteId])); setShowExportModal('excel')
                      }
                    }} style={iconBtnStyle}>⬇ EXCEL</button>
                    <button onClick={() => {
                      if (routes.length === 1) {
                        exportFlightTable([{ results, routeName: activeRoute.name, variant, emptyWt: configuredEmptyWt, initFuel, waypoints }])
                      } else {
                        setExportRouteIds(new Set([activeRouteId])); setShowExportModal('print')
                      }
                    }} style={iconBtnStyle}>⬇ PRINT / PDF</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', background: t.bg0 }}>
                  {(stopAlert || results.alerts?.length > 0) && (
                    <div style={{ padding: '8px 16px 0' }}>
                      <WcaPanel
                        alerts={results.alerts}
                        stopAlert={stopAlert}
                        advisoriesEnabled={settings.wcaAdvisoriesEnabled}
                        onOpenWca={() => { setPendingWca(settings); setWcaTab('ADVISORY'); setShowWca(true) }}
                      />
                    </div>
                  )}
                  <ResultsTable results={results} inputWaypoints={waypoints} targetWptIdx={targetWptIdx}
                    cspWptIdx={cspWptIdx ?? null}
                    onSelectWpt={setSelectedWpt} onSelectLeg={setSelectedLeg}
                    selectedWpt={selectedWpt} selectedLeg={selectedLeg}
                    alerts={results.alerts ?? []} jokerFuel={settings.jokerFuel} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right fold tab + resize handle (zero-width wrapper) ── */}
      <div style={{ width: 0, flexShrink: 0, position: 'relative', zIndex: 500, visibility: tableFullscreen ? 'hidden' : 'visible' }}>
        {/* Resize handle — only when panel is open */}
        {!rightFolded && (
          <div
            onMouseDown={e => { rightDragRef.current = { startX: e.clientX, startWidth: rightWidth }; e.preventDefault() }}
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = t.accent}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          />
        )}
        {/* Fold tab */}
        <div
          onClick={() => setRightFolded(f => !f)}
          title={rightFolded ? 'Expand routes panel' : 'Collapse routes panel'}
          style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 52,
            background: t.bg2, border: `1px solid ${t.border1}`, borderRight: 'none',
            borderRadius: '8px 0 0 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: t.text2, fontSize: 10,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = t.bg4; e.currentTarget.style.color = t.accent }}
          onMouseLeave={e => { e.currentTarget.style.background = t.bg2; e.currentTarget.style.color = t.text2 }}>
          {rightFolded ? '◀' : '▶'}
        </div>
      </div>

      {/* ── Right panel (routes) ── */}
      {!rightFolded && (
        <RoutePanel
          width={rightWidth}
          activeRoute={activeRoute}
          projectName={projectName} onSetProjectName={setProjectName}
          routes={routes} activeRouteId={activeRouteId}
          onSelectRoute={selectRoute}
          onToggleVisible={toggleRouteVis}
          onShowAll={showAllRoutes}
          onHideAll={hideAllRoutes}
          onDuplicate={duplicateRoute}
          onDelete={deleteRoute}
          onRename={renameRoute}
          onReorder={reorderRoutes}
          onAdd={addRoute}
          onImportJson={importRouteJson}
          onImportExcel={importRouteXls}
        />
      )}
    </div>
  )
}

function Row({ label, children, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ width: 150, fontSize: 12, color: t.text2, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function WtRow({ label, value, t }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
      <span style={{ color: t.text3 }}>{label}</span>
      <span style={{ color: t.text1 }}>{Math.round(value).toLocaleString()}</span>
    </div>
  )
}

// ── Help topic sub-components ────────────────────────────────────────────────
function HelpSection({ title, children, t }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 9, color: t.accent, letterSpacing: 2, fontWeight: 700, marginBottom: 7 }}>
        {title}
      </div>
      <div style={{ color: t.text2, lineHeight: 1.75 }}>{children}</div>
    </div>
  )
}

function HelpMono({ children, t }) {
  return (
    <code style={{
      background: t.bg3, color: t.text0, padding: '1px 6px', borderRadius: 3,
      fontSize: 10, fontFamily: 'monospace',
    }}>{children}</code>
  )
}

function HelpCode({ children, t }) {
  return (
    <pre style={{
      background: t.bg3, color: t.text0, padding: '10px 14px', borderRadius: 5,
      fontSize: 10, fontFamily: 'monospace', overflowX: 'auto',
      margin: '8px 0', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>{children}</pre>
  )
}
