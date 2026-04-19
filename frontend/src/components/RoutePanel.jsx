// Route list panel — manage named routes, switch active route, set colors.
import { useState, useRef } from 'react'
import { useTheme } from '../theme.jsx'

export const ROUTE_COLORS = [
  '#4ab4ff', '#ffa44a', '#4affa4', '#ff55cc', '#aaff44',
  '#ff5555', '#44ffff', '#ffee44', '#cc88ff', '#ff8844',
]

// Eye icon — open (visible) vs closed (hidden, slashed)
function EyeIcon({ open, color }) {
  return open ? (
    <svg width="13" height="9" viewBox="0 0 13 9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.5 0C3.5 0 1 4.5 1 4.5C1 4.5 3.5 9 6.5 9C9.5 9 12 4.5 12 4.5C12 4.5 9.5 0 6.5 0Z"
            stroke={color} strokeWidth="1.2" fill="none"/>
      <circle cx="6.5" cy="4.5" r="1.8" fill={color}/>
    </svg>
  ) : (
    <svg width="13" height="9" viewBox="0 0 13 9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.5 0C3.5 0 1 4.5 1 4.5C1 4.5 3.5 9 6.5 9C9.5 9 12 4.5 12 4.5C12 4.5 9.5 0 6.5 0Z"
            stroke={color} strokeWidth="1.2" fill="none" opacity="0.4"/>
      <circle cx="6.5" cy="4.5" r="1.8" fill={color} opacity="0.4"/>
      <line x1="1" y1="8.5" x2="12" y2="0.5" stroke={color} strokeWidth="1.3"/>
    </svg>
  )
}

// ── Store icon shapes (same as WingStoresPanel, read-only) ───────────────────
function StoreIcon({ storeId, x, y, t }) {
  if (storeId.startsWith('eft')) {
    const c = t.accent
    return (
      <g>
        <ellipse cx={x} cy={y} rx="6" ry="7" fill={c} opacity="0.75" stroke={c} strokeWidth="0.5"/>
        <ellipse cx={x} cy={y - 4} rx="3" ry="1.5" fill={c} opacity="0.9"/>
        <line x1={x} y1={y - 10} x2={x} y2={y - 7} stroke={c} strokeWidth="1"/>
      </g>
    )
  }
  if (storeId.startsWith('hf')) {
    const c = t.accent2
    return (
      <g>
        <rect x={x - 5} y={y - 4} width="10" height="8" rx="1" fill="none" stroke={c} strokeWidth="1"/>
        <line x1={x} y1={y - 4} x2={x} y2={y + 4} stroke={c} strokeWidth="0.7"/>
        <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke={c} strokeWidth="0.7"/>
        <polygon points={`${x-3.5},${y+4} ${x-2.5},${y+4} ${x-3},${y+7}`} fill={c}/>
        <polygon points={`${x+2.5},${y+4} ${x+3.5},${y+4} ${x+3},${y+7}`} fill={c}/>
        <polygon points={`${x-3.5},${y-4} ${x-2.5},${y-4} ${x-3},${y-7}`} fill={c}/>
        <polygon points={`${x+2.5},${y-4} ${x+3.5},${y-4} ${x+3},${y-7}`} fill={c}/>
      </g>
    )
  }
  if (storeId.startsWith('rocket')) {
    const c = t.ok
    return (
      <g>
        <circle cx={x}     cy={y}     r="6.5" fill="none" stroke={c} strokeWidth="1.5"/>
        <circle cx={x}     cy={y}     r="1.2" fill={c}/>
        <circle cx={x - 3} cy={y - 2.5} r="1" fill={c}/>
        <circle cx={x + 3} cy={y - 2.5} r="1" fill={c}/>
        <circle cx={x - 3} cy={y + 2.5} r="1" fill={c}/>
        <circle cx={x + 3} cy={y + 2.5} r="1" fill={c}/>
        <circle cx={x}     cy={y - 4.5} r="1" fill={c}/>
        <circle cx={x}     cy={y + 4.5} r="1" fill={c}/>
      </g>
    )
  }
  if (storeId.startsWith('eo')) {
    const c = '#f59e0b'
    return (
      <g>
        <rect x={x - 5} y={y - 6} width="10" height="12" rx="3" fill={c} opacity="0.75" stroke={c} strokeWidth="0.5"/>
        <circle cx={x} cy={y} r="3" fill="none" stroke={t.bg0} strokeWidth="1.2"/>
        <circle cx={x} cy={y} r="1.2" fill={t.bg0}/>
      </g>
    )
  }
  return null
}

// ── Mini aircraft diagram (read-only, same SVG layout as WingStoresPanel) ────
const STATION_SVG_X = { l_outboard: 100, l_inboard: 120, r_inboard: 200, r_outboard: 220 }
const STATION_IDS   = ['l_outboard', 'l_inboard', 'r_inboard', 'r_outboard']

function WingStoresDiagram({ stations, fcrOn, compodOn, variant, t }) {
  const isPeten = variant === 'peten'

  const fcrFill   = fcrOn   ? t.accent : t.bg3
  const fcrStroke = fcrOn   ? t.accent : t.border1
  const fcrText   = fcrOn   ? t.bg0    : t.text3

  const cpdFill   = compodOn ? t.accent : t.bg3
  const cpdStroke = compodOn ? t.accent : t.border1
  const cpdText   = compodOn ? t.bg0    : t.text3

  return (
    <svg viewBox="0 0 320 112" width="100%" style={{ display: 'block' }}>
      {/* FCR dome */}
      {!isPeten && (
        <g opacity={fcrOn ? 0.9 : 0.45}>
          <rect x="138.5" y="10" width="43" height="16" rx="6"
            fill={fcrFill} stroke={fcrStroke} strokeWidth="1.2"/>
          <text x="160" y="17" textAnchor="middle" fill={fcrText} fontSize="6"
            fontFamily={t.font} fontWeight="700" letterSpacing="1">FCR</text>
          <text x="160" y="24" textAnchor="middle" fill={fcrText} fontSize="5.5" fontFamily={t.font}>
            {fcrOn ? 'ON' : 'OFF'}
          </text>
          <line x1="160" y1="26" x2="160" y2="38"
            stroke={fcrStroke} strokeWidth="1" strokeDasharray={fcrOn ? '' : '2 2'}/>
        </g>
      )}

      {/* Wing stores group — same 1.15× scale as AircraftDiagram */}
      <g transform="translate(160,55) scale(1.15) translate(-160,-55)">
        {/* Fuselage */}
        <rect x="130" y="40" width="60" height="30" rx="6" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>
        <text x="160" y="49" textAnchor="middle" fill={t.text3} fontSize="6" fontFamily={t.font} letterSpacing="0.5">M230</text>
        <text x="160" y="61" textAnchor="middle" fill={t.text3} fontSize="6" fontFamily={t.font} letterSpacing="0.5">30MM</text>
        <circle cx="160" cy="55" r="38" fill="none" stroke={t.border2} strokeWidth="1" strokeDasharray="4 3"/>

        {/* Wing stubs */}
        <rect x="90"  y="48" width="40" height="9" rx="2" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>
        <rect x="190" y="48" width="40" height="9" rx="2" fill={t.bg2} stroke={t.border0} strokeWidth="1"/>

        {/* COMPOD — only for non-Peten */}
        {!isPeten && (
          <g opacity={compodOn ? 0.9 : 0.35}>
            <path d="M 63,46 L 75,46 L 75,57 Q 75,62 70,62 L 68,62 Q 63,62 63,57 Z"
              fill={cpdFill} stroke={cpdStroke} strokeWidth="1.2"/>
            <text x="69" y="53" textAnchor="middle" fill={cpdText} fontSize="5.5"
              fontFamily={t.font} fontWeight="700" letterSpacing="0.5">CPD</text>
            <text x="69" y="60" textAnchor="middle" fill={cpdText} fontSize="5" fontFamily={t.font}>
              {compodOn ? 'ON' : 'OFF'}
            </text>
            <line x1="75" y1="52" x2="90" y2="52"
              stroke={cpdStroke} strokeWidth="1" strokeDasharray={compodOn ? '' : '2 2'}/>
          </g>
        )}

        {/* Pylon dots */}
        {[100, 120, 200, 220].map(x => (
          <circle key={x} cx={x} cy="52" r="3" fill={t.accent}/>
        ))}

        {/* Pylon labels */}
        {[['L-OB', 100], ['L-IB', 120], ['R-IB', 200], ['R-OB', 220]].map(([label, x]) => (
          <text key={x} x={x} y="35" textAnchor="middle" fill={t.text3} fontSize="7" fontFamily={t.font}>
            {label}
          </text>
        ))}

        {/* Store icons */}
        {STATION_IDS.map(id => {
          const sid = stations[id]
          if (!sid || sid === 'none') return null
          return <StoreIcon key={id} storeId={sid} x={STATION_SVG_X[id]} y={73} t={t}/>
        })}
      </g>
    </svg>
  )
}

// ── Summary stat row ──────────────────────────────────────────────────────────
function SumRow({ label, value, highlight, t }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', borderBottom: `1px solid ${t.border0}` }}>
      <span style={{ fontSize: 10, color: t.text3, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: highlight ? '#fb923c' : t.text0 }}>{value}</span>
    </div>
  )
}

function minToHMS(min) {
  const h = Math.floor(min / 60), m = Math.floor(min % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

// ── Route summary (lower 40%) ────────────────────────────────────────────────
function RouteSummary({ route, t }) {
  if (!route) return null
  const { waypoints = [], results, config = {} } = route
  const {
    stationsConfig = { l_outboard: 'none', l_inboard: 'none', r_inboard: 'none', r_outboard: 'none' },
    fcrOn    = false,
    compodOn = false,
    variant  = 'LB',
  } = config

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2 }}>ROUTE SUMMARY</div>

      <SumRow label="WAYPOINTS" value={waypoints.length} t={t} />

      <WingStoresDiagram
        stations={stationsConfig}
        fcrOn={fcrOn}
        compodOn={compodOn}
        variant={variant}
        t={t}
      />

      {results ? (
        <>
          <SumRow label="DISTANCE"    value={`${results.total_distance_nm} NM`}                                                                                                      t={t} />
          <SumRow label="FLIGHT TIME" value={minToHMS(results.total_time_min)}                                                                                                       t={t} />
          <SumRow label="FUEL BURN"   value={`${Math.round(results.total_fuel_burned_lbs).toLocaleString()} LB`}                                                          highlight t={t} />
          <SumRow label="FUEL REM"    value={`${Math.round(results.waypoints?.[results.waypoints.length - 1]?.fuel_remaining_lbs ?? 0).toLocaleString()} LB`}                       t={t} />
        </>
      ) : (
        <div style={{
          marginTop: 4, padding: '10px', borderRadius: 4,
          background: t.bg3, border: `1px solid ${t.border0}`,
          fontSize: 11, color: t.text3, textAlign: 'center', lineHeight: 1.5,
        }}>
          Route not calculated yet
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RoutePanel({
  width = 230,
  activeRoute,
  projectName, onSetProjectName,
  routes, activeRouteId, onSelectRoute,
  onToggleVisible, onShowAll, onHideAll, onDuplicate, onDelete, onRename, onAdd,
  onReorder,
  onImportJson, onImportExcel,
}) {
  const { t } = useTheme()
  const [editingId,       setEditingId]       = useState(null)
  const [editName,        setEditName]        = useState('')
  const [editingProject,  setEditingProject]  = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [dragOverId,      setDragOverId]      = useState(null)
  const dragFromIdRef = useRef(null)

  const smallBtn = {
    fontSize: 10, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
    fontFamily: t.font, border: 'none', background: 'none',
  }
  const ctrlBtn = {
    fontSize: 14, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
    fontFamily: t.font, border: 'none', background: 'none', lineHeight: 1,
  }

  return (
    <div style={{
      width, background: t.bg1, display: 'flex', flexDirection: 'column',
      flexShrink: 0, height: '100%', borderLeft: `1px solid ${t.border0}`, fontFamily: t.font,
    }}>

      {/* ══ UPPER 60% — route list ══════════════════════════════════════════ */}
      <div style={{ flex: '0 0 60%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Project name */}
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${t.border0}`, background: t.bg0, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: t.text3, letterSpacing: 2, marginBottom: 3 }}>PROJECT</div>
          {editingProject ? (
            <input
              autoFocus
              value={projectName}
              onChange={e => onSetProjectName(e.target.value)}
              onBlur={() => { setEditingProject(false); if (!projectName.trim()) onSetProjectName('Ilana') }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
              style={{
                width: '100%', background: t.bg3, border: `1px solid ${t.accent}`, borderRadius: 3,
                color: t.accent, fontFamily: t.font, fontSize: 15, fontWeight: 700,
                padding: '2px 6px', outline: 'none', letterSpacing: 1, boxSizing: 'border-box',
              }}
            />
          ) : (
            <div onClick={() => setEditingProject(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: t.accent, letterSpacing: 1 }}>{projectName}</span>
              <span style={{ fontSize: 10, color: t.text3 }}>✎</span>
            </div>
          )}
        </div>

        {/* Route list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 5px' }}>
            <span style={{ fontSize: 10, color: t.text3, letterSpacing: 2 }}>ROUTES {routes.length}/10</span>
            {routes.length < 10 && (
              <button onClick={onAdd} style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                fontFamily: t.font, letterSpacing: 0.5,
                background: t.bg4, border: `1px solid ${t.border1}`, color: t.accent,
              }}>+ NEW</button>
            )}
          </div>

          {routes.map(route => {
            const isActive  = route.id === activeRouteId
            const isEditing = editingId === route.id
            return (
              <div
                key={route.id}
                draggable
                onDragStart={e => { dragFromIdRef.current = route.id; e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => { e.preventDefault(); setDragOverId(route.id) }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => {
                  e.preventDefault(); setDragOverId(null)
                  if (dragFromIdRef.current !== null && dragFromIdRef.current !== route.id)
                    onReorder(dragFromIdRef.current, route.id)
                  dragFromIdRef.current = null
                }}
                onDragEnd={() => { setDragOverId(null); dragFromIdRef.current = null }}
                onClick={() => onSelectRoute(route.id)}
                style={{
                  padding: '6px 12px', cursor: 'pointer',
                  background: dragOverId === route.id ? t.bg3 : isActive ? t.bg4 : 'transparent',
                  borderLeft: `3px solid ${isActive ? route.color : 'transparent'}`,
                  borderTop: dragOverId === route.id ? `2px solid ${t.accent}` : '2px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => { onRename(route.id, editName || route.name); setEditingId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%', background: t.bg3, border: `1px solid ${t.accent}`,
                      borderRadius: 3, color: t.text0, fontFamily: t.font,
                      fontSize: 12, padding: '1px 5px', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, color: t.text3, cursor: 'grab', lineHeight: 1, flexShrink: 0 }}>⠿</span>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: route.color, flexShrink: 0, opacity: route.visible ? 1 : 0.3 }} />
                    <button
                      onClick={e => { e.stopPropagation(); onToggleVisible(route.id) }}
                      title={route.visible ? 'Hide on map' : 'Show on map'}
                      style={{ ...smallBtn, padding: '0 2px', display: 'flex', alignItems: 'center' }}
                    ><EyeIcon open={route.visible} color={route.visible ? t.accent : t.text3} /></button>
                    <span style={{
                      flex: 1, fontSize: 13, fontWeight: isActive ? 700 : 400,
                      color: isActive ? t.text0 : t.text2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      opacity: route.visible ? 1 : 0.5,
                    }}>{route.name}</span>
                    <div style={{ display: 'flex', gap: 1 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingId(route.id); setEditName(route.name) }} title="Rename"
                        style={{ ...ctrlBtn, color: t.text3 }}>✎</button>
                      <button onClick={() => onDuplicate(route.id)} title="Duplicate route"
                        style={{ ...ctrlBtn, color: t.text3, opacity: routes.length >= 10 ? 0.3 : 1 }}
                        disabled={routes.length >= 10}>⧉</button>
                      {routes.length > 1 && (
                        confirmDeleteId === route.id ? (
                          <>
                            <button onClick={() => { onDelete(route.id); setConfirmDeleteId(null) }}
                              style={{ ...ctrlBtn, fontSize: 10, color: t.bg0, background: t.warn, borderRadius: 3, padding: '1px 5px' }}>DEL</button>
                            <button onClick={() => setConfirmDeleteId(null)}
                              style={{ ...ctrlBtn, fontSize: 10, color: t.text2 }}>✕</button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(route.id)} title="Delete route"
                            style={{ ...ctrlBtn, color: t.warn }}>🗑</button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Visibility bulk controls */}
        {(() => {
          const allVisible  = routes.every(r => r.visible)
          const noneVisible = routes.every(r => !r.visible)
          return (
            <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderTop: `1px solid ${t.border0}`, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: t.text3, letterSpacing: 1, flex: 1 }}>VISIBILITY</span>
              <button onClick={onShowAll} title="Show all routes" style={{ ...smallBtn, fontSize: 10, padding: '2px 8px', borderRadius: 3,
                color: allVisible ? t.bg0 : t.text3, background: allVisible ? t.accent : 'none',
                border: `1px solid ${allVisible ? t.accent : t.border0}`, fontWeight: allVisible ? 700 : 400,
              }}>ALL</button>
              <button onClick={onHideAll} title="Hide all routes" style={{ ...smallBtn, fontSize: 10, padding: '2px 8px', borderRadius: 3,
                color: noneVisible ? t.bg0 : t.text3, background: noneVisible ? t.text3 : 'none',
                border: `1px solid ${noneVisible ? t.text3 : t.border0}`, fontWeight: noneVisible ? 700 : 400,
              }}>NONE</button>
            </div>
          )
        })()}

        {/* Import route from file */}
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${t.border0}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: t.text3, letterSpacing: 2, marginBottom: 5 }}>INSERT ROUTE FROM</div>
          <div style={{ display: 'flex', gap: 5 }}>
            <label style={{
              flex: 1, fontSize: 10, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, background: t.bg3, border: `1px solid ${t.border0}`, color: t.text2,
              textAlign: 'center', display: 'block', userSelect: 'none',
            }}>
              ↑ JSON
              <input type="file" accept=".json" style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} onChange={onImportJson} />
            </label>
            <label style={{
              flex: 1, fontSize: 10, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, background: t.bg3, border: `1px solid ${t.border0}`, color: t.text2,
              textAlign: 'center', display: 'block', userSelect: 'none',
            }}>
              ↑ EXCEL
              <input type="file" accept=".xlsx,.xls" style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} onChange={onImportExcel} />
            </label>
          </div>
        </div>

      </div>{/* end upper 60% */}

      {/* ══ LOWER 40% — route summary ════════════════════════════════════════ */}
      <div style={{ flex: '0 0 40%', minHeight: 0, borderTop: `2px solid ${t.border1}`, background: t.bg0, overflowY: 'auto' }}>
        <RouteSummary route={activeRoute} t={t} />
      </div>


    </div>
  )
}
