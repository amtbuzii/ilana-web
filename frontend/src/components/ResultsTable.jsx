// Results table — show per-waypoint and per-leg performance data plus height profile view.
import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../theme.jsx'
import HeightProfileView from './HeightProfileView.jsx'

// ── UTM conversion (WGS84) ────────────────────────────────────────────────────
function latLonToUTM(lat, lon) {
  const a = 6378137.0, f = 1/298.257223563, b = a*(1-f)
  const e2 = (a*a-b*b)/(a*a), e2p = e2/(1-e2), k0 = 0.9996
  const latR = lat*Math.PI/180
  const zone = Math.floor((lon+180)/6)+1
  const lon0 = ((zone-1)*6-180+3)*Math.PI/180
  const sinL = Math.sin(latR), cosL = Math.cos(latR), tanL = Math.tan(latR)
  const N = a/Math.sqrt(1-e2*sinL*sinL), T = tanL*tanL, C = e2p*cosL*cosL
  const A = cosL*((lon*Math.PI/180)-lon0)
  const M = a*((1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*latR-(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*latR)+(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*latR)-(35*e2*e2*e2/3072)*Math.sin(6*latR))
  const easting  = Math.round(k0*N*(A+(1-T+C)*A*A*A/6+(5-18*T+T*T+72*C-58*e2p)*Math.pow(A,5)/120)+500000)
  const northing = Math.round((lat<0?10000000:0)+k0*(M+N*tanL*(A*A/2+(5-T+9*C+4*C*C)*Math.pow(A,4)/24+(61-58*T+T*T+600*C-330*e2p)*Math.pow(A,6)/720)))
  const letter = 'CDEFGHJKLMNPQRSTUVWXX'[Math.min(Math.max(Math.floor((lat+80)/8),0),20)]
  return { zone, letter, easting, northing }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

const parseHMS = (s = '') => {
  const [h = 0, m = 0, sec = 0] = s.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}

const fmtHMS = (totalSec) => {
  const s = Math.round(Math.abs(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sc = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`
}

const minToHMS = (totalMin) => fmtHMS(totalMin * 60)

export default function ResultsTable({ results, inputWaypoints = [], targetWptIdx = null, cspWptIdx = null, onSelectWpt, onSelectLeg, selectedWpt, selectedLeg, alerts = [] }) {
  const { t } = useTheme()
  const { legs, waypoints, total_distance_nm, total_time_min, total_fuel_burned_lbs } = results

  // Build per-waypoint alert lookup: index → highest-severity alert (for badge)
  // leg index i is terrain-alerted when a TERRAIN_CLEARANCE alert exists for wpt_index i+1
  const terrainAlertLegs = new Set(
    alerts.filter(a => a.code === 'TERRAIN_CLEARANCE').map(a => a.wpt_index - 1)
  )

  const alertsByWpt = {}
  // index → all alerts (for popup)
  const alertsByWptAll = {}
  for (const a of alerts) {
    const prev = alertsByWpt[a.wpt_index]
    const order = { WARNING: 0, CAUTION: 1, ADVISORY: 2 }
    if (!prev || order[a.level] < order[prev.level]) alertsByWpt[a.wpt_index] = a
    if (!alertsByWptAll[a.wpt_index]) alertsByWptAll[a.wpt_index] = []
    alertsByWptAll[a.wpt_index].push(a)
  }

  const [view, setView] = useState('points')
  // WCA popup: { wptIdx, x, y } or null
  const [wcaPopup, setWcaPopup] = useState(null)
  const popupRef = useRef(null)

  useEffect(() => {
    if (!wcaPopup) return
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) setWcaPopup(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [wcaPopup])

  const totWpt     = targetWptIdx !== null ? (inputWaypoints[targetWptIdx] ?? null) : null
  const timeMode   = totWpt?.tot_mode ?? 'daytime'
  const targetTime = totWpt?.tot_time ?? ''

  // Returns the display time for waypoint i relative to the TOT waypoint.
  // In daytime mode: adds cumulative time offset to the absolute TOT clock time,
  // wrapping at midnight via modulo 86400.
  const getWptTime = (wptIdx) => {
    if (targetWptIdx === null) return null
    const offsetSec = (waypoints[wptIdx].cum_time_min - waypoints[targetWptIdx].cum_time_min) * 60
    if (timeMode === 'ttime') return (offsetSec >= 0 ? 'T+' : 'T-') + fmtHMS(offsetSec)
    if (!targetTime) return '—'
    const raw = ((parseHMS(targetTime) + offsetSec) % 86400 + 86400) % 86400
    return fmtHMS(raw)
  }

  const showTimeCol = targetWptIdx !== null
  const timeColHdr  = timeMode === 'ttime' ? 'T-TIME' : 'DAY TIME'
  const showHoldCol = waypoints.some(w => w.hold_type)

  const WPT_HEADERS = [
    'POINT', 'GW LBS', 'FUEL LBS',
    'LEG TIME', 'FLT TIME',
    ...(showTimeCol ? [timeColHdr] : []),
    'LEG NM', 'RANGE NM',
    'OGE%', 'IGE%', 'PA%',
    'TRQ%', 'FF LB/H',
    'WIND DIR', 'WIND KTS',
    'SURF FT', 'ALT FT', 'TAS KTS', 'TEMP °C',
    'CLIMB FPM', 'SE KTS', 'DE KTS',
    'SPARE%', 'HOLD TYPE', 'HOLD MIN', 'HOLD SPD',
    'OGE',
    'UTM ZONE', 'UTM EAST', 'UTM NORTH',
  ]

  const LEG_HEADERS = [
    'LEG', 'GW LBS', 'FUEL BURN',
    'LEG TIME', 'FLT TIME',
    ...(showTimeCol ? [timeColHdr] : []),
    'LEG NM', 'LEG DIR °',
    'OGE%', 'IGE%', 'PA%',
    'TRQ%', 'FF LB/H',
    'WIND DIR', 'WIND KTS',
    'SURF FT', 'ALT FT', 'TAS KTS', 'TEMP °C',
    'CLIMB FPM', 'SE KTS', 'DE KTS',
    'SPARE%', 'HOLD TYPE', 'HOLD MIN', 'HOLD SPD',
    'OGE',
    'UTM ZONE', 'UTM EAST', 'UTM NORTH',
  ]

  return (
    <div style={{ padding: '8px 16px', fontSize: 11, fontFamily: t.font, background: t.bg0 }}>

      {/* ── View toggle ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[['points', 'POINTS'], ['legs', 'LEGS'], ['profile', 'HEIGHT PROFILE']].map(([v, label]) => (
          <button key={v} onClick={() => {
            setView(v)
            // Clear cross-view selection when switching
            if (v === 'legs')    onSelectWpt?.(null)
            if (v !== 'legs')    onSelectLeg?.(null)
          }} style={{
            padding: '3px 14px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
            fontFamily: t.font, fontWeight: 700, letterSpacing: 1,
            background: view === v ? t.bg4 : t.bg2,
            color: view === v ? t.text0 : t.text2,
            border: `1px solid ${view === v ? t.border1 : t.border0}`,
          }}>{label}</button>
        ))}
      </div>

      {/* ── Totals bar ── */}
      <div style={{
        display: 'flex', gap: 24, padding: '6px 12px', marginBottom: 8,
        background: t.bg2, borderRadius: 4, border: `1px solid ${t.border0}`,
      }}>
        <Stat label="TOTAL DIST"  value={`${total_distance_nm} NM`}      t={t} />
        <Stat label="TOTAL TIME"  value={minToHMS(total_time_min)}        t={t} />
        <Stat label="FUEL BURNED" value={`${Math.round(total_fuel_burned_lbs).toLocaleString()} LBS`} t={t} />
        <Stat label="FUEL REM"    value={`${Math.round(waypoints[waypoints.length - 1]?.fuel_remaining_lbs ?? 0).toLocaleString()} LBS`} t={t} />
      </div>

      {/* ── POINTS table ── */}
      {view === 'points' && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: t.bg2, borderBottom: `1px solid ${t.border0}` }}>
                {WPT_HEADERS.map(h => (
                  <th key={h} style={{ padding: '3px 7px', textAlign: 'left', whiteSpace: 'nowrap', fontSize: 10, color: t.text2, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waypoints.map((w, i) => {
                const wptTime  = getWptTime(i)
                const isTarget = i === targetWptIdx
                const isCsp    = i === cspWptIdx
                const isSel    = i === selectedWpt
                const rowBg    = isSel   ? t.border1 + '33'
                               : isTarget || isCsp ? t.bg4
                               : 'transparent'
                const marker = (isTarget ? '⏱ ' : '') + (isCsp ? '▶ ' : '')
                const leg = legs[i] ?? null
                const inWpt = inputWaypoints[i] ?? {}
                const lat = parseFloat(w.lat), lon = parseFloat(w.lon)
                const utm = (!isNaN(lat) && !isNaN(lon)) ? latLonToUTM(lat, lon) : null
                return (
                  <tr key={i}
                    onClick={() => onSelectWpt?.(i === selectedWpt ? null : i)}
                    style={{
                      borderBottom: `1px solid ${isCsp ? t.caution + '66' : isTarget ? t.border1 + '66' : t.border2}`,
                      cursor: 'pointer', background: rowBg,
                      outline: isSel ? `1px solid ${t.accent}` : 'none',
                    }}>
                    {/* NAME + inline WCA badge */}
                    <Td t={t} bold accent={isTarget}>
                      {(() => {
                        const top = alertsByWpt[i]
                        if (top) {
                          const isOpen = wcaPopup?.wptIdx === i
                          const STYLE = { WARNING: { color: t.warn, icon: '⚠' }, CAUTION: { color: t.caution, icon: '◆' }, ADVISORY: { color: t.accent, icon: 'ℹ' } }
                          const { color, icon } = STYLE[top.level]
                          return (
                            <button onClick={e => { e.stopPropagation(); if (isOpen) { setWcaPopup(null); return } const r = e.currentTarget.getBoundingClientRect(); setWcaPopup({ wptIdx: i, x: r.left, y: r.bottom + 4, top: r.top }) }}
                              style={{ fontSize: 9, fontWeight: 700, color, background: isOpen ? color+'44' : color+'22', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', border: `1px solid ${isOpen ? color : 'transparent'}`, fontFamily: t.font, marginRight: 5 }}>
                              {icon} {top.level[0]}</button>
                          )
                        }
                        return null
                      })()}
                      {marker && <span style={{ color: isTarget ? t.accent : t.caution, marginRight: 2 }}>{marker}</span>}
                      {w.name}
                    </Td>
                    {/* GW / FUEL */}
                    <Td t={t} warn={w.gross_weight_lbs > 21000}>{Math.round(w.gross_weight_lbs).toLocaleString()}</Td>
                    <Td t={t}>{Math.round(w.fuel_remaining_lbs).toLocaleString()}</Td>
                    {/* LEG TIME / FLT TIME */}
                    <Td t={t} dim>{leg ? minToHMS(leg.leg_time_min) : '—'}</Td>
                    <Td t={t} accent={isTarget} bold={isTarget}>{minToHMS(w.cum_time_min)}</Td>
                    {/* DAY TIME / T-TIME */}
                    {showTimeCol && <Td t={t} accent highlight={isTarget}>{wptTime ?? '—'}</Td>}
                    {/* LEG NM / RANGE NM */}
                    <Td t={t} dim>{leg ? leg.distance_nm : '—'}</Td>
                    <Td t={t} dim>{w.cum_dist_nm}</Td>
                    {/* HOVER PERFORMANCE */}
                    <Td t={t} warn={!w.oge_feasible}>{w.oge_torque_required_pct}%</Td>
                    <Td t={t} dim>{w.ige_torque_required_pct}%</Td>
                    <Td t={t}>{w.pa_available_pct}%</Td>
                    {/* CRUISE PERFORMANCE */}
                    <Td t={t} warn={w.cruise_torque_pct > 100}>{w.cruise_torque_pct}%</Td>
                    <Td t={t}>{w.fuel_flow_lb_hr}</Td>
                    {/* WIND */}
                    <Td t={t} dim>{w.wind_speed_kts > 0 ? String(Math.round(w.wind_dir) % 360).padStart(3, '0') + '°' : '—'}</Td>
                    <Td t={t} dim>{w.wind_speed_kts > 0 ? Math.round(w.wind_speed_kts) : '—'}</Td>
                    {/* ALTITUDE */}
                    <Td t={t} dim>{inWpt.surface_alt_ft || '—'}</Td>
                    <Td t={t} dim>{w.alt_ft}</Td>
                    <Td t={t}>{w.tas_kts}</Td>
                    <Td t={t} dim>{w.oat_c}</Td>
                    {/* CLIMB / SE / DE */}
                    <Td t={t} ok={w.max_roc_fpm > 0} warn={w.max_roc_fpm < 0}>{w.max_roc_fpm}</Td>
                    <Td t={t} warn={w.se_min_speed_kts === null} ok={w.se_min_speed_kts === 0}>
                      {w.se_min_speed_kts === null ? 'N/A' : w.se_min_speed_kts === 0 ? 'HOVR' : w.se_min_speed_kts}
                    </Td>
                    <Td t={t} warn={w.de_min_speed_kts === null} ok={w.de_min_speed_kts === 0}>
                      {w.de_min_speed_kts === null ? 'N/A' : w.de_min_speed_kts === 0 ? 'HOVR' : w.de_min_speed_kts}
                    </Td>
                    {/* SPARE / HOLD */}
                    <Td t={t} orange={w.spare_pct > 0}>{w.spare_pct}%</Td>
                    <Td t={t} caution={!!w.hold_type}>{w.hold_type || '—'}</Td>
                    <Td t={t}>{w.hold_type ? w.hold_min : '—'}</Td>
                    <Td t={t} dim>{w.hold_type ? (inWpt.hold_speed_kts ?? '—') : '—'}</Td>
                    {/* OGE GO/NO */}
                    <Td t={t} ok={w.oge_feasible} warn={!w.oge_feasible} bold>{w.oge_feasible ? '◆ GO' : '✗ NO'}</Td>
                    {/* UTM */}
                    <Td t={t} dim>{utm ? `${utm.zone}${utm.letter}` : '—'}</Td>
                    <Td t={t} dim>{utm ? utm.easting : '—'}</Td>
                    <Td t={t} dim>{utm ? utm.northing : '—'}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── LEGS table ── */}
      {view === 'legs' && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: t.bg2, borderBottom: `1px solid ${t.border0}` }}>
                {LEG_HEADERS.map(h => (
                  <th key={h} style={{ padding: '3px 7px', textAlign: 'left', whiteSpace: 'nowrap', fontSize: 10, color: t.text2, letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {legs.map((l, i) => {
                const isSel = i === selectedLeg
                return (
                  <tr key={i}
                    onClick={() => onSelectLeg?.(i === selectedLeg ? null : i)}
                    style={{
                      borderBottom: `1px solid ${t.border2}`, cursor: 'pointer',
                      background: isSel ? t.border1 + '33' : 'transparent',
                      outline: isSel ? `1px solid ${t.accent}` : 'none',
                    }}>
                    {/* LEG name */}
                    <Td t={t} bold accent>
                      {terrainAlertLegs.has(i) && (
                        <span style={{ color: t.caution, marginRight: 4, fontSize: 10 }} title="Terrain clearance caution">◆</span>
                      )}
                      {l.from_name} → {l.to_name}
                    </Td>
                    {/* GW / FUEL BURN */}
                    <Td t={t} warn={l.gross_weight_lbs > 21000}>{Math.round(l.gross_weight_lbs).toLocaleString()}</Td>
                    <Td t={t}>{Math.round(l.fuel_burned_lbs).toLocaleString()}</Td>
                    {/* LEG TIME / FLT TIME */}
                    <Td t={t}>{minToHMS(l.leg_time_min)}</Td>
                    <Td t={t} dim>—</Td>
                    {/* DAY TIME / T-TIME */}
                    {showTimeCol && <Td t={t} dim>—</Td>}
                    {/* LEG NM / LEG DIR */}
                    <Td t={t} dim>{l.distance_nm}</Td>
                    <Td t={t} accent>{l.leg_direction_deg}°</Td>
                    {/* HOVER PERFORMANCE */}
                    <Td t={t} warn={!l.oge_feasible}>{l.oge_torque_required_pct}%</Td>
                    <Td t={t} dim>{l.ige_torque_required_pct}%</Td>
                    <Td t={t}>{l.pa_available_pct}%</Td>
                    {/* CRUISE PERFORMANCE — from departure waypoint */}
                    <Td t={t} warn={waypoints[i].cruise_torque_pct > 100}>{waypoints[i].cruise_torque_pct}%</Td>
                    <Td t={t}>{waypoints[i].fuel_flow_lb_hr}</Td>
                    {/* WIND */}
                    <Td t={t} dim>{l.wind_speed_kts > 0 ? String(Math.round(l.wind_dir) % 360).padStart(3, '0') + '°' : '—'}</Td>
                    <Td t={t} dim>{l.wind_speed_kts > 0 ? Math.round(l.wind_speed_kts) : '—'}</Td>
                    {/* ALTITUDE */}
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>{l.alt_from_ft} → {l.alt_to_ft}</Td>
                    <Td t={t}>{l.tas_kts}</Td>
                    <Td t={t} dim>{l.oat_c}</Td>
                    {/* CLIMB / SE / DE */}
                    <Td t={t} ok={l.climb_fpm > 0} warn={l.climb_fpm < 0}>{l.climb_fpm}</Td>
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>—</Td>
                    {/* SPARE / HOLD */}
                    <Td t={t} orange={l.spare_pct > 0}>{l.spare_pct}%</Td>
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>—</Td>
                    {/* OGE GO/NO */}
                    <Td t={t} ok={l.oge_feasible} warn={!l.oge_feasible} bold>{l.oge_feasible ? '◆ GO' : '✗ NO'}</Td>
                    {/* UTM */}
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>—</Td>
                    <Td t={t} dim>—</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── HEIGHT PROFILE view ── */}
      {view === 'profile' && (
        <HeightProfileView
          inputWaypoints={inputWaypoints}
          results={results}
          onSelectWpt={onSelectWpt}
          selectedWpt={selectedWpt}
        />
      )}

      {/* ── WCA alert popup ── */}
      {wcaPopup && (() => {
        const popAlerts = alertsByWptAll[wcaPopup.wptIdx] ?? []
        const LEVEL_COLOR = { WARNING: t.warn, CAUTION: t.caution, ADVISORY: t.accent }
        const LEVEL_ICON  = { WARNING: '⚠', CAUTION: '◆', ADVISORY: 'ℹ' }
        return (
          <div ref={popupRef} style={{
            position: 'fixed', zIndex: 9000,
            left: Math.min(wcaPopup.x, window.innerWidth - 268),
            top: (() => {
              const estimatedH = popAlerts.length * 62 + 32
              const spaceBelow = window.innerHeight - wcaPopup.y
              const spaceAbove = wcaPopup.top
              if (spaceBelow < estimatedH && spaceAbove > spaceBelow)
                return Math.max(4, wcaPopup.top - estimatedH - 4)
              return Math.min(wcaPopup.y, window.innerHeight - estimatedH - 4)
            })(),
            width: 260, background: t.bg1,
            border: `1px solid ${t.border1}`, borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
            fontFamily: t.font, overflow: 'hidden',
          }}>
            <div style={{
              padding: '6px 10px', background: t.bg2,
              borderBottom: `1px solid ${t.border0}`,
              fontSize: 9, fontWeight: 700, color: t.text2, letterSpacing: 2,
            }}>
              WCA — {waypoints[wcaPopup.wptIdx]?.name ?? `WP${wcaPopup.wptIdx + 1}`}
            </div>
            {popAlerts.map((a, idx) => {
              const color = LEVEL_COLOR[a.level]
              return (
                <div key={idx} style={{
                  padding: '7px 10px',
                  borderLeft: `3px solid ${color}`,
                  background: color + '0d',
                  borderBottom: idx < popAlerts.length - 1 ? `1px solid ${t.border0}` : 'none',
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color, marginBottom: 3, letterSpacing: 1 }}>
                    {LEVEL_ICON[a.level]} {a.level}
                  </div>
                  <div style={{ fontSize: 10, color: t.text1, lineHeight: 1.4 }}>{a.message}</div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ── Hold summary cards ── */}
      {waypoints.some(w => w.hold_type) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: t.text3, marginBottom: 5, letterSpacing: 2 }}>HOLDS</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {waypoints.filter(w => w.hold_type).map((w, i) => (
              <div key={i} style={{
                padding: '5px 10px', borderRadius: 4, background: t.bg2,
                border: `1px solid ${t.caution}`, minWidth: 120,
              }}>
                <div style={{ fontWeight: 700, color: t.text0, letterSpacing: 1, marginBottom: 2 }}>{w.name}</div>
                <div style={{ fontSize: 9, color: t.caution }}>
                  ⏱ {w.hold_type === 'ground' ? 'GND' : w.hold_type === 'hover' ? 'HOVER' : 'ORBIT'} {w.hold_min}min
                </div>
                <div style={{ color: t.warn, fontSize: 10 }}>−{w.hold_fuel_burned_lbs} LBS</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Table cell with semantic colour props
function Td({ children, t, warn, ok, bold, dim, accent, highlight, caution, orange }) {
  const color = warn ? t.warn : orange ? '#a855f7' : ok ? t.ok : caution ? t.caution : accent ? t.accent : dim ? t.text2 : t.text1
  return (
    <td style={{
      padding: '3px 7px', color, whiteSpace: 'nowrap',
      fontWeight: bold || highlight ? 700 : 'normal',
      background: highlight ? t.bg4 : 'transparent',
    }}>
      {children}
    </td>
  )
}

// Summary stat with a small label and a large value
function Stat({ label, value, t }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: t.text3, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontWeight: 700, color: t.text0, fontSize: 13 }}>{value}</div>
    </div>
  )
}
