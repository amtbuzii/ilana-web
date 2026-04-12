// Wing stores panel — configure pylon loads, compute ATF/ΔF, and enter weapon counts.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../theme.jsx'

const STATION_LAYOUT = [
  { id: 'l_outboard', label: 'L-OB', type: 'outboard' },
  { id: 'l_inboard',  label: 'L-IB', type: 'inboard'  },
  { id: 'r_inboard',  label: 'R-IB', type: 'inboard'  },
  { id: 'r_outboard', label: 'R-OB', type: 'outboard' },
]

const DEFAULT_STATIONS = {
  l_inboard: 'eft_230', r_inboard: 'eft_230',
  l_outboard: 'hf_4rnd', r_outboard: 'hf_4rnd',
}

// Compute ATF (Aerodynamic Trim Factor) from ΔF values without a backend call.
// ATF = 1 + ΔF/100.  ΔF accumulates per-station drag penalties minus FCR bonus,
// plus optional COMPOD drag.
function localComputeAtf(stations, s, fcrOn, compodOn) {
  const storeDf = {
    none:        { ib: 0,       ob: 0 },
    eft_230:     { ib: s.dfEftIb,  ob: s.dfEftOb },
    hf_4rnd:     { ib: s.dfHfIb,   ob: s.dfHfOb  },
    eo_launcher: { ib: s.dfEoIb,   ob: s.dfEoOb  },
    rocket_m261: { ib: s.dfRktIb,  ob: s.dfRktOb },
  }
  let df = s.dfNoWeapons
  for (const [station, storeId] of Object.entries(stations)) {
    const entry = storeDf[storeId] ?? { ib: 0, ob: 0 }
    df += station.includes('inboard') ? entry.ib : entry.ob
  }
  if (!fcrOn)   df -= s.fcrDeltaF
  if (compodOn) df += s.compodDeltaF
  return { deltaF: Math.round(df * 1000) / 1000, atf: Math.round((1.0 + df / 100) * 1000) / 1000 }
}

export default function WingStoresPanel({ initialStations, initialFcrOn = false, initialCompodOn = false, onAtfChange, onStationsChange, variant, gunAmmo, onGunAmmoChange, hfMissiles, onHfMissilesChange, eoMissiles, onEoMissilesChange, rocketRounds, onRocketRoundsChange, onFcrChange, onCompodChange, fcrDeltaF = 0.81, compodDeltaF = 0.0, storeDfSettings }) {
  const { t } = useTheme()
  const [config, setConfig]       = useState(null)
  const [stations, setStations]   = useState(initialStations ?? DEFAULT_STATIONS)
  const [atf, setAtf]             = useState(1.0)
  const [deltaF, setDeltaF]       = useState(0.0)
  const [expanded, setExpanded]   = useState(false)
  const [fcrOn, setFcrOn]         = useState(initialFcrOn)
  const [compodOn, setCompodOn]   = useState(initialCompodOn)

  // Sync internal state when the parent switches to a different route (prop reference changes).
  // Using a ref to compare previous values avoids triggering on every render.
  const syncRef = useRef({ initialStations, initialFcrOn, initialCompodOn })
  useEffect(() => {
    const prev = syncRef.current
    if (prev.initialStations !== initialStations) setStations(initialStations ?? DEFAULT_STATIONS)
    if (prev.initialFcrOn    !== initialFcrOn)    setFcrOn(initialFcrOn)
    if (prev.initialCompodOn !== initialCompodOn) setCompodOn(initialCompodOn)
    syncRef.current = { initialStations, initialFcrOn, initialCompodOn }
  }, [initialStations, initialFcrOn, initialCompodOn])  // eslint-disable-line

  // Peten (AH-64A) has no FCR dome or COMPOD
  const isPeten = variant === 'peten'
  useEffect(() => { if (isPeten) { setFcrOn(false); setCompodOn(false) } }, [isPeten])

  useEffect(() => { onFcrChange?.(fcrOn) },       [fcrOn])    // eslint-disable-line
  useEffect(() => { onCompodChange?.(compodOn) }, [compodOn]) // eslint-disable-line

  // Count stations carrying each weapon type to know which load inputs to show
  const hfCount  = Object.values(stations).filter(s => s === 'hf_4rnd').length
  const eoCount  = Object.values(stations).filter(s => s === 'eo_launcher').length
  const rktCount = Object.values(stations).filter(s => s === 'rocket_m261').length

  useEffect(() => { onStationsChange?.(stations) }, [stations])   // eslint-disable-line

  // Fetch store definitions and presets from backend (labels, pylon compatibility)
  useEffect(() => {
    fetch('/api/drag/config').then(r => r.json()).then(setConfig).catch(() => {})
  }, [])

  // Recompute ATF whenever anything that affects drag changes
  useEffect(() => {
    if (!storeDfSettings) return
    const { deltaF: df, atf: a } = localComputeAtf(stations, storeDfSettings, fcrOn, compodOn)
    setAtf(a); setDeltaF(df); onAtfChange(a)
  }, [stations, fcrOn, compodOn, storeDfSettings])   // eslint-disable-line

  const storesFor = useCallback((type) => config ? config.stores.filter(s => s.pylon_types.includes(type)) : [], [config])

  // Color ATF: amber if high drag (>1.02), caution if suspiciously low (<0.94)
  const atfColor = atf > 1.02 ? t.warn : atf < 0.94 ? t.caution : t.atfOk

  return (
    <div style={{ borderBottom: `1px solid ${t.border0}` }}>
      <div onClick={() => setExpanded(e => !e)} style={{
        padding: '8px 16px', cursor: 'pointer', userSelect: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: t.bg2,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.text2, letterSpacing: 2 }}>WING STORES</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Show ATF/ΔF summary in collapsed state */}
          {!expanded && <>
            <span style={{ fontWeight: 700, fontSize: 11, color: atfColor, background: t.bg3, padding: '1px 8px', borderRadius: 3, border: `1px solid ${atfColor}`, letterSpacing: 1 }}>ATF {atf.toFixed(3)}</span>
            <span style={{ fontWeight: 700, fontSize: 11, color: t.text2, background: t.bg3, padding: '1px 8px', borderRadius: 3, border: `1px solid ${t.text2}`, letterSpacing: 1 }}>ΔF {deltaF.toFixed(3)}</span>
          </>}
          <span style={{ color: t.text3, fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '8px 16px', background: t.bg3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 700, fontSize: 12, color: atfColor,
              background: t.bg2, padding: '3px 10px', borderRadius: 4,
              border: `1px solid ${atfColor}`, letterSpacing: 1, fontFamily: t.font,
            }}>ATF {atf.toFixed(3)}</span>
            <span style={{
              fontWeight: 700, fontSize: 9, letterSpacing: 1,
              padding: '3px 8px', borderRadius: 4, fontFamily: t.font,
              color: fcrOn ? t.bg0 : t.caution,
              background: fcrOn ? t.ok : 'none',
              border: `1px solid ${fcrOn ? t.ok : t.caution}`,
            }}>FCR {fcrOn ? 'ON  +0' : `OFF  −${fcrDeltaF.toFixed(3)}`}</span>
            {!isPeten && <span style={{
              fontWeight: 700, fontSize: 9, letterSpacing: 1,
              padding: '3px 8px', borderRadius: 4, fontFamily: t.font,
              color: compodOn ? t.bg0 : t.text3,
              background: compodOn ? t.caution : 'none',
              border: `1px solid ${compodOn ? t.caution : t.border1}`,
            }}>COMPOD {compodOn ? `ON  +${compodDeltaF.toFixed(3)}` : 'OFF  +0'}</span>}
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: t.text3, marginBottom: 4, letterSpacing: 2 }}>QUICK PRESETS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {config?.presets?.map(p => (
                <button key={p.id} onClick={() => setStations({ ...p.stations })} title={p.label} style={{
                  fontSize: 9, padding: '2px 7px', borderRadius: 3, border: `1px solid ${t.border0}`,
                  background: t.bg2, color: t.text1, cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: t.font, letterSpacing: 0.5,
                }}>{presetShortLabel(p.id)}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: t.text3, marginBottom: 4, letterSpacing: 2 }}>STATION CONFIG</div>
            <AircraftDiagram stations={stations} storesFor={storesFor} onChange={(id, v) => setStations(s => ({...s, [id]: v}))} gunAmmo={gunAmmo} fcrOn={fcrOn} onFcrToggle={() => setFcrOn(v => !v)} fcrDisabled={isPeten} fcrDeltaF={fcrDeltaF} compodOn={compodOn} onCompodToggle={() => setCompodOn(v => !v)} t={t} />
          </div>

          {/* Gun ammo — tracked for weight but doesn't affect ATF */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border0}` }}>
            <div style={{ fontSize: 9, color: t.text3, marginBottom: 4, letterSpacing: 2 }}>M230 · 30MM ROUNDS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(() => {
                const num = parseFloat(gunAmmo)
                const invalid = gunAmmo !== '' && !isNaN(num) && (num < 0 || num > 1100)
                return (
                  <input value={gunAmmo} onChange={e => onGunAmmoChange(e.target.value)} placeholder="500"
                    style={{ width: 70, background: invalid ? t.warn + '22' : t.bg2, border: `1px solid ${invalid ? t.warn : t.border0}`, borderRadius: 3, padding: '2px 5px', color: invalid ? t.warn : t.text0, fontSize: 11, fontFamily: t.font }} />
                )
              })()}
              <span style={{ fontSize: 9, color: t.text3 }}>RDS (does not affect ATF)</span>
            </div>
          </div>

          {/* Missile / rocket count inputs — only shown for weapon types actually loaded */}
          {(hfCount > 0 || eoCount > 0 || rktCount > 0) && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border0}` }}>
              <div style={{ fontSize: 9, color: t.text3, marginBottom: 6, letterSpacing: 2 }}>MISSILE / ROCKET LOAD</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {hfCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: t.text2, width: 90 }}>AGM-114 ×</span>
                    <input value={hfMissiles} onChange={e => onHfMissilesChange(e.target.value)}
                      style={{ width: 45, background: t.bg2, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11, fontFamily: t.font }} />
                    <span style={{ fontSize: 9, color: t.text3 }}>{hfCount} launcher{hfCount > 1 ? 's' : ''}, dflt {hfCount * 3}</span>
                  </div>
                )}
                {eoCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: t.text2, width: 90 }}>EO msls ×</span>
                    <input value={eoMissiles} onChange={e => onEoMissilesChange(e.target.value)}
                      style={{ width: 45, background: t.bg2, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11, fontFamily: t.font }} />
                    <span style={{ fontSize: 9, color: t.text3 }}>{eoCount} launcher{eoCount > 1 ? 's' : ''}, dflt {eoCount * 2}</span>
                  </div>
                )}
                {rktCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: t.text2, width: 90 }}>Rockets ×</span>
                    <input value={rocketRounds} onChange={e => onRocketRoundsChange(e.target.value)}
                      style={{ width: 45, background: t.bg2, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11, fontFamily: t.font }} />
                    <span style={{ fontSize: 9, color: t.text3 }}>{rktCount} launcher{rktCount > 1 ? 's' : ''}, dflt {rktCount * 4}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 9, color: t.text3, fontStyle: 'italic', lineHeight: 1.5 }}>
            ΔF APPROX — VERIFY AGAINST TM(IS) FIG 7-42
          </div>
        </div>
      )}
    </div>
  )
}

function AircraftDiagram({ stations, storesFor, onChange, gunAmmo, fcrOn, onFcrToggle, fcrDisabled, fcrDeltaF, compodOn, onCompodToggle, t }) {
  // SVG x-position for each pylon (used for both icon placement and hit targets)
  const STATION_SVG_X = { l_outboard: 100, l_inboard: 120, r_inboard: 200, r_outboard: 220 }

  // FCR dome visual state
  const fcrFill    = fcrDisabled ? t.bg2    : fcrOn    ? t.accent : t.bg3
  const fcrStroke  = fcrDisabled ? t.border0 : fcrOn   ? t.accent : t.border1
  const fcrText    = fcrDisabled ? t.text3  : fcrOn    ? t.bg0    : t.text3
  const fcrOpacity = fcrDisabled ? 0.35     : fcrOn    ? 0.9      : 0.55

  // COMPOD visual state
  const cpdFill    = compodOn ? t.accent : t.bg3
  const cpdStroke  = compodOn ? t.accent : t.border1
  const cpdText    = compodOn ? t.bg0    : t.text3
  const cpdOpacity = compodOn ? 0.9      : 0.55

  return (
    <div>
      <svg viewBox="0 0 320 112" width="100%" style={{ display: 'block', marginBottom: 4 }}>
        {/* FCR dome — hidden for Peten variant */}
        {!fcrDisabled && (
          <g onClick={onFcrToggle} style={{ cursor: 'pointer' }}>
            <rect x="138.5" y="10" width="43" height="16" rx="6"
              fill={fcrFill} stroke={fcrStroke} strokeWidth="1.2" opacity={fcrOpacity}/>
            <text x="160" y="17" textAnchor="middle" fill={fcrText} fontSize="6" fontFamily={t.font} fontWeight="700" letterSpacing="1">FCR</text>
            <text x="160" y="24" textAnchor="middle" fill={fcrText} fontSize="5.5" fontFamily={t.font}>
              {fcrOn ? 'ON' : `OFF −${fcrDeltaF.toFixed(2)}`}
            </text>
            <line x1="160" y1="26" x2="160" y2="38" stroke={fcrStroke} strokeWidth="1" strokeDasharray={!fcrOn ? '2 2' : ''}/>
          </g>
        )}

        {/* Wing stores group — scaled 1.15× outward from fuselage centre (160,55) */}
        <g transform="translate(160,55) scale(1.15) translate(-160,-55)">
          {/* Fuselage */}
          <rect x="130" y="40" width="60" height="30" rx="6" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>
          <text x="160" y="51" textAnchor="middle" fill={t.text3} fontSize="6" fontFamily={t.font} letterSpacing="1">M230 · 30MM</text>
          <text x="160" y="63" textAnchor="middle" fill={t.accent} fontSize="9" fontWeight="700" fontFamily={t.font}>{gunAmmo || '500'} RDS</text>
          <circle cx="160" cy="55" r="38" fill="none" stroke={t.border2} strokeWidth="1" strokeDasharray="4 3"/>
          {/* Wing stubs */}
          <rect x="90"  y="48" width="40" height="9" rx="2" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>
          <rect x="190" y="48" width="40" height="9" rx="2" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>
          {/* COMPOD — left of L-OB pylon, hidden for Peten */}
          {!fcrDisabled && <g onClick={onCompodToggle} style={{ cursor: 'pointer' }}>
            <path d="M 63,46 L 75,46 L 75,57 Q 75,62 70,62 L 68,62 Q 63,62 63,57 Z"
              fill={cpdFill} stroke={cpdStroke} strokeWidth="1.2" opacity={cpdOpacity}/>
            <text x="69" y="53" textAnchor="middle" fill={cpdText} fontSize="5.5" fontFamily={t.font} fontWeight="700" letterSpacing="0.5">CPD</text>
            <text x="69" y="60" textAnchor="middle" fill={cpdText} fontSize="5" fontFamily={t.font}>{compodOn ? 'ON' : 'OFF'}</text>
            <line x1="75" y1="52" x2="90" y2="52" stroke={cpdStroke} strokeWidth="1" strokeDasharray={compodOn ? '' : '2 2'}/>
          </g>}
          {/* Pylon dots */}
          {[100,120,200,220].map(x => <circle key={x} cx={x} cy="52" r="3" fill={t.accent}/>)}
          {/* Pylon labels */}
          {[['L-OB',100],['L-IB',120],['R-IB',200],['R-OB',220]].map(([label,x]) => (
            <text key={x} x={x} y="35" textAnchor="middle" fill={t.text3} fontSize="7" fontFamily={t.font}>{label}</text>
          ))}
          {/* Store icons rendered below each loaded pylon */}
          {STATION_LAYOUT.map(st => {
            const x = STATION_SVG_X[st.id]
            const sid = stations[st.id]
            if (!sid || sid === 'none') return null
            return <StoreIcon key={st.id} storeId={sid} x={x} y={73} t={t} />
          })}
        </g>
      </svg>

      {/* Station dropdowns — one per pylon */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
        {STATION_LAYOUT.map(st => (
          <div key={st.id}>
            <div style={{ fontSize: 8, color: t.text3, marginBottom: 2, textAlign: 'center', letterSpacing: 1 }}>{st.label}</div>
            <select value={stations[st.id] || 'none'} onChange={e => onChange(st.id, e.target.value)} style={{
              width: '100%', background: t.bg2, border: `1px solid ${t.border0}`,
              borderRadius: 3, padding: '2px 3px', color: t.text1, fontSize: 9, fontFamily: t.font,
            }}>
              {storesFor(st.type).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// SVG icon for a store type — shapes are schematic, not to scale
function StoreIcon({ storeId, x, y, t }) {
  if (storeId.startsWith('eft')) {
    // External fuel tank — vertical capsule / drop-tank silhouette
    const c = t.accent
    return (
      <g>
        <ellipse cx={x} cy={y} rx="6" ry="7" fill={c} opacity="0.75" stroke={c} strokeWidth="0.5"/>
        <ellipse cx={x} cy={y-4} rx="3" ry="1.5" fill={c} opacity="0.9"/>
        <line x1={x} y1={y-10} x2={x} y2={y-7} stroke={c} strokeWidth="1"/>
      </g>
    )
  }
  if (storeId.startsWith('hf')) {
    // Hellfire M299 launcher — rack outline with 4 missile nose tips (2×2 grid)
    const c = t.accent2
    return (
      <g>
        <rect x={x-5} y={y-4} width="10" height="8" rx="1" fill="none" stroke={c} strokeWidth="1"/>
        <line x1={x} y1={y-4} x2={x} y2={y+4} stroke={c} strokeWidth="0.7"/>
        <line x1={x-5} y1={y} x2={x+5} y2={y} stroke={c} strokeWidth="0.7"/>
        <polygon points={`${x-3.5},${y+4} ${x-2.5},${y+4} ${x-3},${y+7}`} fill={c}/>
        <polygon points={`${x+2.5},${y+4} ${x+3.5},${y+4} ${x+3},${y+7}`} fill={c}/>
        <polygon points={`${x-3.5},${y-4} ${x-2.5},${y-4} ${x-3},${y-7}`} fill={c}/>
        <polygon points={`${x+2.5},${y-4} ${x+3.5},${y-4} ${x+3},${y-7}`} fill={c}/>
      </g>
    )
  }
  if (storeId.startsWith('rocket')) {
    // Rocket pod M261 — circular face view with tube pattern
    const c = t.ok
    return (
      <g>
        <circle cx={x} cy={y} r="6.5" fill="none" stroke={c} strokeWidth="1.5"/>
        <circle cx={x}   cy={y}   r="1.2" fill={c}/>
        <circle cx={x-3} cy={y-2.5} r="1"   fill={c}/>
        <circle cx={x+3} cy={y-2.5} r="1"   fill={c}/>
        <circle cx={x-3} cy={y+2.5} r="1"   fill={c}/>
        <circle cx={x+3} cy={y+2.5} r="1"   fill={c}/>
        <circle cx={x}   cy={y-4.5} r="1"   fill={c}/>
        <circle cx={x}   cy={y+4.5} r="1"   fill={c}/>
      </g>
    )
  }
  if (storeId.startsWith('eo')) {
    // EO launcher — sensor pod: rectangular body with lens circle
    const c = '#f59e0b'
    return (
      <g>
        <rect x={x-5} y={y-6} width="10" height="12" rx="3" fill={c} opacity="0.75" stroke={c} strokeWidth="0.5"/>
        <circle cx={x} cy={y} r="3" fill="none" stroke={t.bg0} strokeWidth="1.2"/>
        <circle cx={x} cy={y} r="1.2" fill={t.bg0}/>
      </g>
    )
  }
  return null
}

// Short display label for preset buttons
function presetShortLabel(id) {
  return {
    '2eft_2hf':      '2EFT+2HF',
    'hf_eft_eft_rkt':'HF·EFT·EFT·RKT',
    'hf_eft_eft_eo': 'HF·EFT·EFT·EO',
    'clean':         'CLEAN',
  }[id] || id
}
