// Height profile chart — flight altitude vs terrain elevation with zoom/pan and waypoint tooltips.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '../theme.jsx'

async function fetchTerrainProfile(waypoints, stepKm) {
  const res = await fetch('/api/terrain-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      waypoints: waypoints.map(w => ({ lat: parseFloat(w.lat), lon: parseFloat(w.lon) })),
      step_km: stepKm,
    }),
  })
  if (!res.ok) throw new Error('Terrain fetch failed')
  return res.json()
}

// Returns a human-friendly grid step for a given altitude range, targeting ~5 gridlines.
// Rounds to 1/2/5 × a power of ten (e.g. 500, 1000, 2000 ft).
function niceGridStep(range) {
  const raw = range / 5
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const n   = raw / mag
  const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return step * mag
}

export default function HeightProfileView({ inputWaypoints, results, onSelectWpt, selectedWpt }) {
  const { t }                       = useTheme()
  const [terrain, setTerrain]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error,   setError]         = useState(null)
  const [stepKm,  setStepKm]        = useState(1)
  const [svgW,    setSvgW]          = useState(800)
  const [tooltip, setTooltip]       = useState(null)
  // viewBox: null = full view; {x,y,w,h} = zoomed/panned region in chart coords
  const [vb,      setVb]            = useState(null)
  const dragRef       = useRef(null)   // { startX, startY, startVB, rect }
  const hasDraggedRef = useRef(false)  // distinguishes click from drag on waypoint circles
  const containerRef  = useRef(null)

  // Track SVG container width for responsive sizing
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width || 800))
    ro.observe(containerRef.current)
    setSvgW(containerRef.current.offsetWidth || 800)
    return () => ro.disconnect()
  }, [])

  const loadTerrain = useCallback(async () => {
    const valid = inputWaypoints.filter(w => w.lat && w.lon && !isNaN(parseFloat(w.lat)))
    if (valid.length < 2) return
    setLoading(true); setError(null); setTerrain(null); setVb(null)
    try {
      const { points } = await fetchTerrainProfile(valid, stepKm)
      setTerrain(points)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [inputWaypoints, stepKm])

  if (!results) return null

  const wpts      = results.waypoints
  const H         = 280
  const PAD       = { top: 22, right: 16, bottom: 36, left: 58 }
  const W         = Math.max(300, svgW)
  const cW        = W - PAD.left - PAD.right
  const cH        = H - PAD.top  - PAD.bottom
  const totalDist = Math.max(results.total_distance_nm, 0.01)

  // Determine altitude range to show, padding 15% above the highest point
  const flightAlts  = wpts.map(w => w.alt_ft)
  const terrainAlts = terrain?.length ? terrain.map(p => p.elev_ft) : []
  const rawMin      = Math.min(0, ...terrainAlts, ...flightAlts)
  const rawMax      = Math.max(...flightAlts, ...terrainAlts)
  const rangePad    = Math.max((rawMax - rawMin) * 0.15, 500)
  const minAlt      = rawMin
  const maxAlt      = rawMax + rangePad

  // Chart-coordinate helpers (distance → x pixel, altitude → y pixel, and inverse)
  const toX   = d => (d / totalDist) * cW
  const toY   = a => cH - ((a - minAlt) / (maxAlt - minAlt)) * cH
  const fromY = y => minAlt + (1 - y / cH) * (maxAlt - minAlt)

  const fullVB = { x: 0, y: 0, w: cW, h: cH }
  const curVB  = vb ?? fullVB

  // Scale factors: screen pixels per chart unit (used to keep stroke widths constant)
  const scaleX = cW / curVB.w
  const scaleY = cH / curVB.h

  // Adaptive Y-axis grid based on the currently visible altitude window
  const visAltMin = fromY(curVB.y + curVB.h)
  const visAltMax = fromY(curVB.y)
  const gridStep  = niceGridStep(visAltMax - visAltMin)
  const gridBase  = Math.ceil(visAltMin / gridStep) * gridStep
  const gridAlts  = []
  for (let a = gridBase; a <= visAltMax + gridStep * 0.5; a += gridStep) gridAlts.push(a)

  // Convert chart coordinates to outer-SVG pixel coordinates (for labels and tooltip)
  const chartToSvgX = x => PAD.left + ((x - curVB.x) / curVB.w) * cW
  const chartToSvgY = y => PAD.top  + ((y - curVB.y) / curVB.h) * cH

  // Split terrain into contiguous runs separated by missing-data gaps,
  // so each run can be rendered as a distinct filled path
  const terrainRuns = []
  if (terrain?.length >= 2) {
    let start = 0
    for (let i = 1; i <= terrain.length; i++) {
      const prev = terrain[i - 1].missing
      const cur  = i < terrain.length ? terrain[i].missing : !prev
      if (cur !== prev) {
        terrainRuns.push({ missing: prev, pts: terrain.slice(start, i) })
        start = i
      }
    }
  }

  // Build a closed SVG path for a terrain run (filled down to the x-axis baseline)
  const buildTerrainPath = pts => {
    if (pts.length < 2) return ''
    const body = pts.map(p => `${toX(p.dist_nm).toFixed(1)},${toY(p.elev_ft).toFixed(1)}`).join(' L')
    const x0 = toX(pts[0].dist_nm).toFixed(1)
    const xN = toX(pts[pts.length - 1].dist_nm).toFixed(1)
    return `M${x0},${cH} L${body} L${xN},${cH} Z`
  }

  const flightPts = wpts.map(w =>
    `${toX(w.cum_dist_nm).toFixed(1)},${toY(w.alt_ft).toFixed(1)}`
  ).join(' ')

  const hasMissing = terrain?.some(p => p.missing)

  // Find the terrain sample closest to a given route distance (for tooltip)
  const terrainAt = dist_nm => {
    if (!terrain?.length) return null
    return terrain.reduce((best, p) =>
      Math.abs(p.dist_nm - dist_nm) < Math.abs(best.dist_nm - dist_nm) ? p : best
    )
  }

  // ── Zoom/pan logic ──────────────────────────────────────────────────────────
  // Zoom into/out of a point (mx, my in chart coords); centres on cursor if provided
  const applyZoom = (factor, mx, my) => {
    const newW = Math.min(curVB.w / factor, cW)
    const newH = Math.min(curVB.h / factor, cH)
    const fracX = mx !== undefined ? (mx - curVB.x) / curVB.w : 0.5
    const fracY = my !== undefined ? (my - curVB.y) / curVB.h : 0.5
    const newX  = Math.max(0, Math.min(mx !== undefined ? mx - fracX * newW : curVB.x + (curVB.w - newW) / 2, cW - newW))
    const newY  = Math.max(0, Math.min(my !== undefined ? my - fracY * newH : curVB.y + (curVB.h - newH) / 2, cH - newH))
    setVb({ x: newX, y: newY, w: newW, h: newH })
  }

  const handleWheel = e => {
    e.preventDefault()
    const rect   = e.currentTarget.getBoundingClientRect()
    // Convert mouse position to chart coords so zoom anchors on the cursor
    const mx     = (e.clientX - rect.left) / rect.width  * curVB.w + curVB.x
    const my     = (e.clientY - rect.top)  / rect.height * curVB.h + curVB.y
    applyZoom(e.deltaY < 0 ? 1.3 : 1 / 1.3, mx, my)
  }

  const handleMouseDown = e => {
    if (e.button !== 0) return
    e.preventDefault()
    hasDraggedRef.current = false
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startVB: { ...curVB },
      rect: e.currentTarget.getBoundingClientRect(),
    }
  }

  const handleMouseMove = e => {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.startX) / dragRef.current.rect.width  * dragRef.current.startVB.w
    const dy = (e.clientY - dragRef.current.startY) / dragRef.current.rect.height * dragRef.current.startVB.h
    // Mark as a drag (not a click) once movement exceeds 2 screen pixels
    if (Math.abs(dx) > 2 / scaleX || Math.abs(dy) > 2 / scaleY) hasDraggedRef.current = true
    const newX = Math.max(0, Math.min(dragRef.current.startVB.x - dx, cW - dragRef.current.startVB.w))
    const newY = Math.max(0, Math.min(dragRef.current.startVB.y - dy, cH - dragRef.current.startVB.h))
    setVb({ ...dragRef.current.startVB, x: newX, y: newY })
  }

  const handleMouseUp = () => { dragRef.current = null }

  const btnSt = { padding: '2px 9px', fontSize: 11, borderRadius: 3, cursor: 'pointer', fontFamily: t.font, background: t.bg4, border: `1px solid ${t.border1}`, color: t.accent }

  return (
    <div>
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1 }}>SAMPLE</span>
        <input type="number" min="0.5" max="50" step="0.5" value={stepKm}
          onChange={e => setStepKm(Math.max(0.5, parseFloat(e.target.value) || 1))}
          style={{ width: 50, background: t.bg3, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11, fontFamily: t.font }} />
        <span style={{ fontSize: 9, color: t.text3 }}>KM</span>
        <button onClick={loadTerrain} disabled={loading} style={{ ...btnSt, color: loading ? t.text3 : t.accent, borderColor: loading ? t.border0 : t.border1, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'LOADING…' : '↻ LOAD TERRAIN'}
        </button>
        <div style={{ width: 1, height: 16, background: t.border0 }} />
        <button onClick={() => applyZoom(1.5)}       style={btnSt} title="Zoom in">+</button>
        <button onClick={() => applyZoom(1 / 1.5)}   style={btnSt} title="Zoom out">−</button>
        <button onClick={() => setVb(null)}           style={{ ...btnSt, letterSpacing: 0 }} title="Reset view">⌂</button>
        {error && <span style={{ fontSize: 10, color: t.warn }}>{error}</span>}
        {!terrain && !loading && !error && (
          <span style={{ fontSize: 10, color: t.text3, fontStyle: 'italic' }}>Click LOAD TERRAIN to fetch SRTM elevation · Scroll/drag to navigate</span>
        )}
        {terrain && <span style={{ fontSize: 9, color: t.text3 }}>{terrain.length} pts · {stepKm} km</span>}
      </div>

      {/* ── SVG ──────────────────────────────────────────────────────────────── */}
      <div ref={containerRef}>
        <svg width={W} height={H} style={{ display: 'block', userSelect: 'none' }}>
          <defs>
            <linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={t.border1} stopOpacity="0.75" />
              <stop offset="100%" stopColor={t.bg3}     stopOpacity="0.25" />
            </linearGradient>
            <clipPath id="hpClip">
              <rect x={PAD.left} y={PAD.top} width={cW} height={cH} />
            </clipPath>
          </defs>

          {/* Y-axis labels — rendered in outer SVG so they stay sharp at any zoom level */}
          {gridAlts.map(a => {
            const svgY = chartToSvgY(toY(a))
            if (svgY < PAD.top - 4 || svgY > PAD.top + cH + 4) return null
            return (
              <text key={a} x={PAD.left - 6} y={svgY + 4}
                textAnchor="end" fontSize={9} fill={t.text3} fontFamily="system-ui">
                {a >= 1000 ? `${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k` : Math.round(a)}
              </text>
            )
          })}

          {/* X-axis labels — one per waypoint */}
          {wpts.map((wp, i) => {
            const svgX = chartToSvgX(toX(wp.cum_dist_nm))
            if (svgX < PAD.left - 2 || svgX > PAD.left + cW + 2) return null
            return (
              <text key={i} x={svgX} y={PAD.top + cH + 16}
                textAnchor="middle" fontSize={9} fill={t.text3} fontFamily="system-ui">
                {wp.cum_dist_nm}
              </text>
            )
          })}

          {/* Axis captions */}
          <text x={PAD.left + cW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={t.text3} fontFamily="system-ui" letterSpacing={1}>DIST NM</text>
          <text x={10} y={PAD.top + cH / 2} textAnchor="middle" fontSize={9} fill={t.text3} fontFamily="system-ui"
            transform={`rotate(-90, 10, ${PAD.top + cH / 2})`}>ALT FT</text>

          {/* Chart content — nested SVG with viewBox drives zoom/pan without re-layout */}
          <svg x={PAD.left} y={PAD.top} width={cW} height={cH}
            viewBox={`${curVB.x} ${curVB.y} ${curVB.w} ${curVB.h}`}
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab', overflow: 'hidden' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}>

            <rect x={0} y={0} width={cW} height={cH} fill={t.bg1} />

            {/* Horizontal grid lines — stroke widths compensate for zoom scale */}
            {gridAlts.map(a => (
              <line key={a} x1={0} y1={toY(a)} x2={cW} y2={toY(a)}
                stroke={t.border0} strokeWidth={0.5 / Math.min(scaleX, scaleY)} strokeDasharray={`${4 / scaleX} ${4 / scaleX}`} />
            ))}

            {/* Axis lines */}
            <line x1={0} y1={0}  x2={0}  y2={cH} stroke={t.border1} strokeWidth={1 / scaleX} />
            <line x1={0} y1={cH} x2={cW} y2={cH} stroke={t.border1} strokeWidth={1 / scaleY} />

            {/* Terrain runs (red fill = missing SRTM data) */}
            {terrainRuns.map((run, ri) => (
              <path key={ri} d={buildTerrainPath(run.pts)}
                fill={run.missing ? '#cc000030' : 'url(#hpGrad)'}
                stroke={run.missing ? '#cc0000' : t.border1}
                strokeWidth={run.missing ? 1 / scaleX : 0.8 / scaleX} />
            ))}

            {/* Flight profile polyline */}
            <polyline points={flightPts} fill="none"
              stroke={t.accent} strokeWidth={2.5 / Math.min(scaleX, scaleY)} />

            {/* Vertical drop lines from each waypoint to the x-axis */}
            {wpts.map((wp, i) => (
              <line key={i}
                x1={toX(wp.cum_dist_nm)} y1={toY(wp.alt_ft)}
                x2={toX(wp.cum_dist_nm)} y2={cH}
                stroke={t.border0} strokeWidth={0.5 / scaleX} strokeDasharray={`${3 / scaleX} ${3 / scaleX}`} />
            ))}

            {/* Waypoint circles — sizes are constant in screen pixels regardless of zoom */}
            {wpts.map((wp, i) => {
              const cx  = toX(wp.cum_dist_nm)
              const cy  = toY(wp.alt_ft)
              const sel = selectedWpt === i
              const r   = (sel ? 7 : 5) / Math.min(scaleX, scaleY)
              const hit = 12 / Math.min(scaleX, scaleY)   // invisible hit area
              const sw  = 1.5 / Math.min(scaleX, scaleY)
              const fs  = 9 / Math.min(scaleX, scaleY)
              return (
                <g key={i} style={{ cursor: 'pointer' }}
                  onClick={e => {
                    e.stopPropagation()
                    // Ignore mouse-up that ends a pan drag
                    if (!hasDraggedRef.current) onSelectWpt?.(sel ? null : i)
                  }}
                  onMouseEnter={() => setTooltip({ cx, cy, wp, i, terr: terrainAt(wp.cum_dist_nm) })}
                  onMouseLeave={() => setTooltip(null)}>
                  <circle cx={cx} cy={cy} r={hit} fill="transparent" />
                  <circle cx={cx} cy={cy} r={r}
                    fill={sel ? '#FFD700' : t.accent}
                    stroke={sel ? '#8B6914' : t.bg0}
                    strokeWidth={sw} />
                  <text x={cx} y={cy - 9 / Math.min(scaleX, scaleY)}
                    textAnchor="middle" fontSize={fs}
                    fill={sel ? '#FFD700' : t.text1} fontFamily="system-ui">
                    {wp.name}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Chart border (drawn over chart content so it stays crisp) */}
          <rect x={PAD.left} y={PAD.top} width={cW} height={cH}
            fill="none" stroke={t.border1} strokeWidth={1} />

          {/* Legend */}
          <g transform={`translate(${PAD.left + cW - 132}, ${PAD.top + 5})`}>
            <rect x={0} y={0} width={130} height={hasMissing ? 55 : terrain ? 42 : 20}
              fill={t.bg2} stroke={t.border0} rx={3} fillOpacity={0.92} />
            <line x1={8} y1={11} x2={22} y2={11} stroke={t.accent} strokeWidth={2.5} />
            <text x={26} y={15} fontSize={9} fill={t.text1} fontFamily="system-ui">Flight altitude</text>
            {terrain && <>
              <rect x={8} y={23} width={14} height={9} fill="url(#hpGrad)" stroke={t.border1} strokeWidth={0.8} />
              <text x={26} y={32} fontSize={9} fill={t.text1} fontFamily="system-ui">Terrain (SRTM)</text>
            </>}
            {hasMissing && <>
              <rect x={8} y={36} width={14} height={9} fill="#cc000030" stroke="#cc0000" strokeWidth={0.8} />
              <text x={26} y={45} fontSize={9} fill="#ff6666" fontFamily="system-ui">No DSM data</text>
            </>}
          </g>

          {/* Tooltip — positioned in outer-SVG screen space so it never gets clipped by the chart area */}
          {tooltip && (() => {
            const svgX = chartToSvgX(tooltip.cx)
            const svgY = chartToSvgY(tooltip.cy)
            // Hide if the waypoint has scrolled out of the visible chart region
            if (svgX < PAD.left - 5 || svgX > PAD.left + cW + 5 ||
                svgY < PAD.top  - 5 || svgY > PAD.top  + cH + 5) return null
            const boxW = 168, boxH = tooltip.terr ? 70 : 54
            const tx = Math.min(W - boxW - 4, svgX + 14)
            const ty = Math.max(4, svgY - boxH - 8)
            const wp = tooltip.wp
            const tr = tooltip.terr
            return (
              <g pointerEvents="none">
                <rect x={tx} y={ty} width={boxW} height={boxH}
                  fill={t.bg2} stroke={t.accent} strokeWidth={0.8} rx={4} />
                <text x={tx+8} y={ty+16} fontSize={11}
                  fill={t.accent} fontWeight="bold" fontFamily="system-ui">{wp.name}</text>
                <text x={tx+8} y={ty+30} fontSize={10}
                  fill={t.text1} fontFamily="system-ui">
                  Flight: {wp.alt_ft} ft  ·  Fuel: {wp.fuel_remaining_lbs} lb
                </text>
                {tr && <text x={tx+8} y={ty+44} fontSize={10}
                  fill={tr.missing ? '#ff6666' : t.text2} fontFamily="system-ui">
                  {tr.missing
                    ? 'No DSM data here'
                    : `Terrain: ${tr.elev_ft} ft  ·  Clearance: ${wp.alt_ft - tr.elev_ft} ft`}
                </text>}
                <text x={tx+8} y={ty+(tr ? 58 : 44)} fontSize={9}
                  fill={t.text3} fontFamily="system-ui">
                  GW: {wp.gross_weight_lbs} lb  OGE: {wp.oge_torque_required_pct}%  {wp.oge_feasible ? '◆GO' : '✗NO'}
                </text>
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}
