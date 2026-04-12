// Waypoint panel — list, reorder, and edit individual waypoints with UTM/GEO coordinate entry.
import { useState, useEffect, useRef } from 'react'
import { utmToLatLon, fetchElevation, latLonToUtm } from '../api.js'
import { useTheme } from '../theme.jsx'

export default function WaypointPanel({ waypoints, activeWpt, onSelect, onUpdate, onAdd, onRemove, onReorder, onReverse, aglOffset = 1000, altMode = 'AGL', targetWptIdx, onSetTarget, cspWptIdx, cspFuel, onSetCsp, onCspFuelChange, onCspAutoOge, onCspAutoIge }) {
  const { t } = useTheme()
  // Shared ref so dragging state survives across card re-renders
  const dragFromRef = useRef(null)

  return (
    <div style={{ fontFamily: t.font }}>
      <div style={{
        padding: '5px 16px', fontSize: 10, color: t.text2, letterSpacing: 1,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>WAYPOINTS — SELECT THEN CLICK MAP</span>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={onReverse}
            title="Reverse route order"
            style={{
              padding: '2px 9px', fontSize: 10, background: t.bg4,
              color: t.text2, border: `1px solid ${t.border0}`, borderRadius: 3,
              cursor: 'pointer', fontFamily: t.font, letterSpacing: 1,
            }}
          >⇅ REV</button>
          <button
            onClick={onAdd}
            style={{
              padding: '2px 9px', fontSize: 10, background: t.bg4,
              color: t.accent, border: `1px solid ${t.border1}`, borderRadius: 3,
              cursor: 'pointer', fontFamily: t.font, letterSpacing: 1,
            }}
          >+ ADD</button>
        </div>
      </div>
      {waypoints.map((wp, i) => (
        <WaypointCard
          key={wp.name || i} index={i} wp={wp}
          isActive={activeWpt === i}
          isTarget={targetWptIdx === i}
          isCsp={cspWptIdx === i}
          cspFuel={cspFuel}
          onSelect={() => onSelect(i === activeWpt ? null : i)}
          onUpdate={(field, val) => onUpdate(i, field, val)}
          onRemove={() => onRemove(i)}
          onSetTarget={() => onSetTarget?.(i)}
          onSetCsp={() => onSetCsp?.(i)}
          onCspFuelChange={onCspFuelChange}
          onCspAutoOge={onCspAutoOge}
          onCspAutoIge={onCspAutoIge}
          aglOffset={aglOffset}
          altMode={altMode}
          dragFromRef={dragFromRef}
          onReorder={onReorder}
        />
      ))}
    </div>
  )
}

function WaypointCard({ index, wp, isActive, isTarget, isCsp, cspFuel, onSelect, onUpdate, onRemove, onSetTarget, onSetCsp, onCspFuelChange, onCspAutoOge, onCspAutoIge, aglOffset = 1000, altMode = 'AGL', dragFromRef, onReorder }) {
  const { t } = useTheme()
  const [utmMode, setUtmMode]           = useState(true)
  const [utm, setUtm]                   = useState({ zone: '36', easting: '', northingPfx: '', northingRest: '' })
  const [utmErr, setUtmErr]             = useState('')
  const [derivedUtm, setDerivedUtm]     = useState(null)
  const [isDragOver, setIsDragOver]     = useState(false)
  const [surfaceAltAuto, setSurfaceAltAuto] = useState(true)
  const [cspMode, setCspMode]           = useState('fuel')   // 'fuel' | 'oge' | 'ige'
  const [cspInput, setCspInput]         = useState('')
  const [confirmDel, setConfirmDel]     = useState(false)
  // Reset armed-delete state when user clicks away
  useEffect(() => { if (!isActive) setConfirmDel(false) }, [isActive])

  // Suppress re-entrant effects when one side drives the other:
  //   suppressUtmEffect    — lat/lon changed by UTM entry, don't overwrite UTM fields
  //   suppressLatLonEffect — lat/lon changed by map click, don't skip UTM display refresh
  const suppressUtmEffect    = useRef(false)
  const suppressLatLonEffect = useRef(false)
  const northingRestRef      = useRef(null)

  // Split a northing integer into its leading digit and the remaining 6 digits
  // (the UI displays them in separate boxes to match the standard 7-digit UTM format)
  const splitNorthing = (n) => {
    const s = String(Math.round(n))
    return { northingPfx: s[0] || '', northingRest: s.slice(1) }
  }

  // When lat/lon changes (e.g. from a map click), convert to UTM for display.
  // If the change came from our own UTM entry, only update derivedUtm for the
  // collapsed header — don't overwrite the fields the user is actively editing.
  useEffect(() => {
    const lat = parseFloat(wp.lat)
    const lon = parseFloat(wp.lon)
    if (!wp.lat || !wp.lon || isNaN(lat) || isNaN(lon)) { setDerivedUtm(null); return }
    const fromUtmEntry = suppressLatLonEffect.current
    if (fromUtmEntry) suppressLatLonEffect.current = false
    let cancelled = false
    latLonToUtm(lat, lon).then(r => {
      if (cancelled) return
      setDerivedUtm(r)
      if (!fromUtmEntry) {
        suppressUtmEffect.current = true
        setUtm({ zone: String(r.zone), easting: String(Math.round(r.easting)), ...splitNorthing(r.northing) })
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [wp.lat, wp.lon])

  // When the user finishes typing a valid UTM coordinate (both easting and
  // northingRest must be exactly 6 digits), convert to lat/lon and fetch
  // the SRTM surface elevation to pre-fill the surface alt field.
  useEffect(() => {
    if (suppressUtmEffect.current) { suppressUtmEffect.current = false; return }
    if (utm.easting.length !== 6 || utm.northingRest.length !== 6) return
    const fullNorthing = utm.northingPfx + utm.northingRest
    const zone    = parseInt(utm.zone)
    const easting = parseFloat(utm.easting)
    const northing = parseFloat(fullNorthing)
    if (!utm.easting || !fullNorthing || isNaN(zone) || isNaN(easting) || isNaN(northing)) return
    let cancelled = false
    setUtmErr('')
    const apply = async () => {
      try {
        const { lat, lon } = await utmToLatLon(zone, easting, northing)
        if (cancelled) return
        suppressLatLonEffect.current = true
        onUpdate('lat', String(lat)); onUpdate('lon', String(lon)); onUpdate('alt_ft', '…')
        const { elevation_ft } = await fetchElevation(lat, lon)
        if (cancelled) return
        onUpdate('surface_alt_ft', String(elevation_ft))
        setSurfaceAltAuto(true)
        onUpdate('alt_ft', altMode === 'MSL' ? String(aglOffset) : String(elevation_ft + aglOffset))
      } catch {
        if (!cancelled) setUtmErr('INVALID UTM')
      }
    }
    apply()
    return () => { cancelled = true }
  }, [utm])   // eslint-disable-line

  const switchToUtm = () => {
    if (derivedUtm) {
      suppressUtmEffect.current = true
      setUtm({ zone: String(derivedUtm.zone), easting: String(Math.round(derivedUtm.easting)), ...splitNorthing(derivedUtm.northing) })
    }
    setUtmErr(''); setUtmMode(true)
  }

  // Shared input style
  const si = {
    background: t.bg3, border: `1px solid ${t.border0}`,
    borderRadius: 3, padding: '2px 5px', color: t.text0, fontSize: 11,
    fontFamily: t.font, boxSizing: 'border-box',
  }

  // Renders a digit-only (or sign+digit) input that updates a single waypoint field
  const numInput = (field, value, maxLen, opts = {}) => {
    const raw = value ?? ''
    const num = parseFloat(raw)
    const hasValue = raw !== '' && raw !== '-' && !isNaN(num)
    const invalid = hasValue && (
      (opts.min !== undefined && num < opts.min) ||
      (opts.max !== undefined && num > opts.max)
    )
    return (
      <input
        value={raw}
        maxLength={maxLen}
        onChange={e => {
          let v = e.target.value
          if (opts.allowNeg) v = v.replace(/[^0-9\-]/g, '')
          else v = v.replace(/\D/g, '')
          if (v.length > maxLen) v = v.slice(0, maxLen)
          if (opts.onChangeCb) opts.onChangeCb()
          onUpdate(field, v)
        }}
        placeholder={opts.placeholder || ''}
        style={{
          ...si,
          width: opts.width || `${maxLen * 9 + 12}px`,
          ...(opts.style || {}),
          ...(invalid ? { border: `1px solid ${t.warn}`, background: t.warn + '22', color: t.warn } : {}),
        }}
      />
    )
  }

  return (
    <div
      data-wpt-idx={index}
      draggable={true}
      onDragStart={e => { dragFromRef.current = index; e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setIsDragOver(false)
        if (dragFromRef.current !== null && dragFromRef.current !== index)
          onReorder(dragFromRef.current, index)
        dragFromRef.current = null
      }}
      onDragEnd={() => { setIsDragOver(false); dragFromRef.current = null }}
      style={{
        margin: '3px 8px', borderRadius: 4,
        border: `1px solid ${isDragOver ? t.accent : isActive ? t.border1 : t.border0}`,
        background: isDragOver ? t.bg4 : isActive ? t.bg4 : t.bg2,
        overflow: 'hidden',
        opacity: isDragOver ? 0.85 : 1,
      }}
    >
      {/* Card header — always visible */}
      <div onClick={onSelect} style={{ padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            onMouseDown={e => e.stopPropagation()}
            style={{ color: t.text3, fontSize: 13, cursor: 'grab', userSelect: 'none', lineHeight: 1 }}
            title="Drag to reorder"
          >⠿</span>
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            background: isActive ? t.border1 : t.border2,
            border: `1px solid ${isActive ? t.border1 : t.border0}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: isActive ? t.bg0 : t.text1, flexShrink: 0,
          }}>{index + 1}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? t.text0 : t.text1, letterSpacing: 1 }}>
            {wp.name || `WP${index + 1}`}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onSetTarget() }}
            title={isTarget ? 'Clear TOT' : 'Set Time on Target'}
            style={{
              padding: '1px 6px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, fontWeight: 700, letterSpacing: 0,
              background: isTarget ? t.bg4 : 'transparent',
              color: isTarget ? t.accent : t.text3,
              border: `1px solid ${isTarget ? t.border1 : t.border0}`,
            }}
          >⏱</button>
          <button
            onClick={e => { e.stopPropagation(); onSetCsp?.() }}
            title={isCsp ? 'Clear CSP' : 'Set as Calculation Start Point'}
            style={{
              padding: '1px 6px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, fontWeight: 700, letterSpacing: 0,
              background: isCsp ? t.bg4 : 'transparent',
              color: isCsp ? t.caution : t.text3,
              border: `1px solid ${isCsp ? t.caution : t.border0}`,
            }}
          >▶</button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {wp.lat && wp.lon && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: t.text2 }}>
                {parseFloat(wp.lat).toFixed(4)}° {parseFloat(wp.lon).toFixed(4)}°
              </div>
              {derivedUtm && (() => {
                const ns = String(Math.round(derivedUtm.northing))
                return <div style={{ fontSize: 9, color: t.text3 }}>{derivedUtm.zone} · {Math.round(derivedUtm.easting)} · {ns[0]} · {ns.slice(1)}</div>
              })()}
            </div>
          )}
          {confirmDel ? (
            <>
              <button onClick={e => { e.stopPropagation(); onRemove() }}
                style={{ background: t.warn, border: 'none', color: t.bg0, cursor: 'pointer', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, fontFamily: t.font }}>DEL</button>
              <button onClick={e => { e.stopPropagation(); setConfirmDel(false) }}
                style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}>✕</button>
            </>
          ) : (
            <button onClick={e => { e.stopPropagation(); setConfirmDel(true) }}
              style={{ background: 'none', border: 'none', color: t.text3, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}>🗑</button>
          )}
        </div>
      </div>

      {/* Expanded editor — shown only for the active waypoint */}
      {isActive && (
        <div style={{ padding: '7px 10px', borderTop: `1px solid ${t.border0}` }}>

          {/* ── NAME ── */}
          <div style={{ marginBottom: 7 }}>
            <FL t={t}>NAME</FL>
            <input
              value={wp.name || ''}
              maxLength={25}
              onChange={e => onUpdate('name', e.target.value)}
              placeholder={`WP${index + 1}`}
              style={{ ...si, width: '25ch' }}
            />
          </div>

          {/* ── Coordinates ── */}
          <div style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {/* UTM / GEO mode toggle */}
              <div style={{ display: 'flex', gap: 3, alignSelf: 'flex-end', paddingBottom: 1 }}>
                {[['UTM', true, switchToUtm], ['GEO', false, () => { setUtmErr(''); setUtmMode(false) }]].map(([label, active, fn]) => (
                  <button key={label} onClick={fn} style={{
                    padding: '2px 7px', fontSize: 10, borderRadius: 3,
                    border: `1px solid ${(utmMode === active) ? t.border1 : t.border0}`,
                    cursor: 'pointer',
                    background: (utmMode === active) ? t.bg4 : t.bg2,
                    color: (utmMode === active) ? t.text0 : t.text2,
                    fontFamily: t.font, letterSpacing: 1, fontWeight: 700,
                  }}>{label}</button>
                ))}
              </div>

              {utmMode ? (
                <>
                  <div>
                    <FL t={t}>ZONE</FL>
                    <input
                      value={utm.zone}
                      maxLength={2}
                      onChange={e => setUtm(u => ({...u, zone: e.target.value.replace(/\D/g, '').slice(0, 2)}))}
                      placeholder="36"
                      style={{ ...si, width: 26, textAlign: 'center' }}
                    />
                  </div>
                  <div>
                    {/* Leading digit of northing (e.g. "3" for ~3,480,000 m) */}
                    <FL t={t}>N</FL>
                    <input
                      value={utm.northingPfx}
                      maxLength={1}
                      onChange={e => setUtm(u => ({...u, northingPfx: e.target.value.replace(/\D/g, '').slice(0, 1)}))}
                      placeholder="3"
                      style={{ ...si, width: 18, textAlign: 'center' }}
                    />
                  </div>
                  <div>
                    <FL t={t}>EASTING</FL>
                    <input
                      value={utm.easting}
                      maxLength={6}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setUtm(u => ({...u, easting: val}))
                        // Auto-advance to northing once easting is complete
                        if (val.length === 6) northingRestRef.current?.focus()
                      }}
                      placeholder="674335"
                      style={{ ...si, width: 56 }}
                    />
                  </div>
                  <div>
                    <FL t={t}>NORTHING</FL>
                    <input
                      ref={northingRestRef}
                      value={utm.northingRest}
                      maxLength={6}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setUtm(u => ({...u, northingRest: val}))
                      }}
                      placeholder="480879"
                      style={{ ...si, width: 56 }}
                    />
                  </div>
                  {utmErr && <span style={{ color: t.warn, fontSize: 10, alignSelf: 'flex-end', paddingBottom: 3 }}>{utmErr}</span>}
                </>
              ) : (
                <>
                  <div>
                    <FL t={t}>LATITUDE</FL>
                    <input
                      value={wp.lat}
                      maxLength={10}
                      onChange={e => onUpdate('lat', e.target.value)}
                      placeholder="32.0853"
                      style={{ ...si, width: 88 }}
                    />
                  </div>
                  <div>
                    <FL t={t}>LONGITUDE</FL>
                    <input
                      value={wp.lon}
                      maxLength={10}
                      onChange={e => onUpdate('lon', e.target.value)}
                      placeholder="34.7818"
                      style={{ ...si, width: 88 }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── ALT / SURFACE / TAS / OAT ── */}
          {(() => {
            const userAlt = parseFloat(wp.alt_ft)
            const surfAlt = parseFloat(wp.surface_alt_ft)
            const hasSurf = wp.surface_alt_ft !== '' && wp.surface_alt_ft != null && !isNaN(surfAlt)
            const hasAlt  = wp.alt_ft !== '' && wp.alt_ft != null && !isNaN(userAlt)
            const belowTerrain = hasAlt && hasSurf && userAlt < surfAlt
            const nearTerrain  = hasAlt && hasSurf && userAlt >= surfAlt && userAlt < surfAlt + 100
            return (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <FL t={t}>ALT FT</FL>
              {numInput('alt_ft', wp.alt_ft, 6, { placeholder: '1000', allowNeg: true, min: -2000, max: 12000 })}
              {belowTerrain && (
                <div style={{ fontSize: 8, color: t.warn, marginTop: 2, letterSpacing: 0.5, maxWidth: 70 }}>
                  ⚠ BELOW DSM<br/><span style={{ color: t.text3 }}>surf {surfAlt} ft</span>
                </div>
              )}
              {nearTerrain && (
                <div style={{ fontSize: 8, color: t.caution, marginTop: 2, letterSpacing: 0.5, maxWidth: 70 }}>
                  ◆ NEAR DSM<br/><span style={{ color: t.text3 }}>+{Math.round(userAlt - surfAlt)} ft clr</span>
                </div>
              )}
            </div>
            <div>
              {/* Asterisk when MSL mode: surface alt is used only for AGL↔MSL display conversion */}
              <FL t={t}>SURFACE{altMode === 'MSL' ? '*' : ''}</FL>
              <input
                value={wp.surface_alt_ft ?? ''}
                maxLength={5}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 5)
                  setSurfaceAltAuto(false)
                  onUpdate('surface_alt_ft', v)
                }}
                placeholder="DSM"
                // Dim the value when it was filled automatically from SRTM
                style={{ ...si, width: `${5 * 9 + 12}px`, color: surfaceAltAuto ? t.text2 : t.text0 }}
              />
            </div>
            <div>
              <FL t={t}>TAS KTS</FL>
              {numInput('airspeed_kts', wp.airspeed_kts, 3, { placeholder: '120', min: 0, max: 150 })}
            </div>
            <div>
              {/* ELR badge shown when OAT is derived from environmental lapse rate */}
              <FL t={t}>OAT °C{wp.oat_auto ? <span style={{ color: t.ok, fontSize: 8, marginLeft: 3 }}>ELR</span> : null}</FL>
              {numInput('oat_c', wp.oat_c, 3, { placeholder: '25', allowNeg: true, min: -15, max: 50 })}
            </div>
          </div>
            )
          })()}

          {/* ── Wind ── */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${t.border0}` }}>
            <div>
              <FL t={t}>WIND DIR °</FL>
              {numInput('wind_dir', wp.wind_dir, 3, { placeholder: '0', min: 0, max: 360 })}
            </div>
            <div>
              <FL t={t}>WIND SPEED KTS</FL>
              {numInput('wind_speed_kts', wp.wind_speed_kts, 3, { placeholder: '0', min: 0, max: 50 })}
            </div>
          </div>

          {/* ── Hold / waiting ── */}
          <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${t.border0}` }}>
            <FL t={t}>HOLD / WAITING</FL>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
              {[['ground','GND'],['hover','HOVER'],['endurance','ENDURANCE']].map(([type, label]) => {
                const active = wp.hold_type === type
                return (
                  <button key={type} onClick={() => onUpdate('hold_type', active ? null : type)} style={{
                    padding: '2px 8px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                    fontFamily: t.font, fontWeight: active ? 700 : 400, letterSpacing: 1,
                    background: active ? t.bg4 : t.bg2,
                    color: active ? t.caution : t.text3,
                    border: `1px solid ${active ? t.caution : t.border0}`,
                  }}>{label}</button>
                )
              })}
            </div>
            {wp.hold_type && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    value={wp.hold_min ?? '5'}
                    maxLength={3}
                    onChange={e => onUpdate('hold_min', e.target.value.replace(/\D/g, '').slice(0, 3))}
                    style={{ width: 34, background: t.bg2, border: `1px solid ${t.caution}`, borderRadius: 3, padding: '2px 4px', color: t.caution, fontSize: 11, fontFamily: t.font, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 9, color: t.text3 }}>MIN</span>
                </div>
                {wp.hold_type === 'endurance' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      value={wp.hold_speed_kts ?? '80'}
                      maxLength={3}
                      onChange={e => onUpdate('hold_speed_kts', e.target.value.replace(/\D/g, '').slice(0, 3))}
                      style={{ width: 34, background: t.bg2, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '2px 4px', color: t.text0, fontSize: 11, fontFamily: t.font, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 9, color: t.text3 }}>KTS</span>
                  </div>
                )}
                <span style={{ fontSize: 8, color: t.text3, fontStyle: 'italic' }}>
                  {wp.hold_type === 'ground'   ? 'FF = 475 lb/hr' :
                   wp.hold_type === 'hover'    ? 'FF from OGE torque' :
                                                 'FF at endurance speed'}
                </span>
              </div>
            )}
          </div>

          {/* ── Spare % — positive adds fuel reserve, negative reduces it ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <FL t={t}>SPARE %</FL>
              {numInput('spare_pct', wp.spare_pct, 3, { placeholder: '0', allowNeg: true, min: -5, max: 40 })}
            </div>
            <div style={{ paddingTop: 14 }}>
              <span style={{ fontSize: 9, color: t.text3, fontStyle: 'italic' }}>
                −5 to 40 · applies onwards · {parseInt(wp.spare_pct) > 0 ? `+${wp.spare_pct}%` : `${wp.spare_pct || 0}%`} FF
              </span>
            </div>
          </div>

          {/* ── TOT section (only when this waypoint is the TOT) ── */}
          {isTarget && (() => {
            const totMode = wp.tot_mode ?? 'daytime'
            return (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.border1}` }}>
                <div style={{ fontSize: 9, color: t.accent, letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>
                  ⏱ TIME ON TARGET
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {[['daytime', 'DAY TIME'], ['ttime', 'T-TIME']].map(([mode, label]) => (
                    <button key={mode} onClick={() => onUpdate('tot_mode', mode)} style={{
                      padding: '2px 9px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                      fontFamily: t.font, fontWeight: 700, letterSpacing: 1,
                      background: totMode === mode ? t.bg4 : t.bg2,
                      color: totMode === mode ? t.text0 : t.text2,
                      border: `1px solid ${totMode === mode ? t.border1 : t.border0}`,
                    }}>{label}</button>
                  ))}
                </div>
                {totMode === 'daytime' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div>
                      <FL t={t}>TOT HH:MM:SS</FL>
                      {(() => {
                        const val = wp.tot_time ?? ''
                        const digits = val.replace(/\D/g, '')
                        const complete = digits.length === 6
                        const h = parseInt(digits.slice(0, 2), 10)
                        const m = parseInt(digits.slice(2, 4), 10)
                        const s = parseInt(digits.slice(4, 6), 10)
                        const invalid = complete && (h > 23 || m > 59 || s > 59)
                        return (
                          <input
                            value={val}
                            maxLength={8}
                            onChange={e => {
                              const d = e.target.value.replace(/\D/g, '').slice(0, 6)
                              let v = d
                              if (d.length > 4) v = d.slice(0, 2) + ':' + d.slice(2, 4) + ':' + d.slice(4)
                              else if (d.length > 2) v = d.slice(0, 2) + ':' + d.slice(2)
                              onUpdate('tot_time', v)
                            }}
                            placeholder="14:30:00"
                            style={{
                              ...si, width: 72,
                              border: `1px solid ${invalid ? t.warn : t.border1}`,
                              background: invalid ? t.warn + '22' : undefined,
                              color: invalid ? t.warn : t.accent,
                              textAlign: 'center', letterSpacing: 2,
                            }}
                          />
                        )
                      })()}
                    </div>
                    <div style={{ paddingBottom: 4, fontSize: 8, color: t.text3, fontStyle: 'italic' }}>
                      local clock time
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 9, color: t.text3, fontStyle: 'italic' }}>
                    This waypoint = T+00:00:00 · all others show T± offset
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── CSP section (only when this waypoint is the CSP) ── */}
          {isCsp && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.caution}` }}>
              <div style={{ fontSize: 9, color: t.caution, letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>
                ▶ CALCULATION START POINT
              </div>
              {/* Fuel source mode: enter fuel directly, or derive it from a hover torque reading */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {[['fuel', 'FUEL'], ['oge', 'OGE'], ['ige', 'IGE']].map(([mode, label]) => (
                  <button key={mode} onClick={() => { setCspMode(mode); setCspInput('') }} style={{
                    padding: '2px 9px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                    fontFamily: t.font, fontWeight: 700, letterSpacing: 1,
                    background: cspMode === mode ? t.bg4 : t.bg2,
                    color: cspMode === mode ? t.caution : t.text2,
                    border: `1px solid ${cspMode === mode ? t.caution : t.border0}`,
                  }}>{label}</button>
                ))}
              </div>
              {cspMode === 'fuel' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div>
                    <FL t={t}>FUEL LBS</FL>
                    <input
                      value={cspFuel ?? ''}
                      maxLength={5}
                      onChange={e => onCspFuelChange?.(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="2500"
                      style={{ ...si, width: 56, border: `1px solid ${t.caution}`, color: t.caution }}
                    />
                  </div>
                </div>
              )}
              {/* OGE/IGE mode: user enters measured torque %, fuel is computed on blur */}
              {(cspMode === 'oge' || cspMode === 'ige') && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <FL t={t}>{cspMode === 'oge' ? 'OGE TORQUE %' : 'IGE TORQUE %'}</FL>
                    <input
                      value={cspInput}
                      maxLength={3}
                      onChange={e => setCspInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      onBlur={() => {
                        if (!cspInput) return
                        if (cspMode === 'oge') onCspAutoOge?.(cspInput)
                        else                   onCspAutoIge?.(cspInput)
                      }}
                      placeholder="100"
                      style={{ ...si, width: 44, border: `1px solid ${t.caution}`, color: t.caution }}
                    />
                  </div>
                  {cspFuel && (
                    <div style={{ paddingBottom: 4, fontSize: 10, color: t.caution, fontWeight: 700 }}>
                      → {cspFuel} LBS
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: 5, fontSize: 8, color: t.text3, fontStyle: 'italic' }}>
                {index === 0
                  ? 'Route computed forward from this waypoint'
                  : 'Route computed backward to WP1, forward to last WP'}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// Field label — small uppercase caption above an input
function FL({ children, t }) {
  return <div style={{ fontSize: 9, color: t.text3, marginBottom: 2, letterSpacing: 1 }}>{children}</div>
}
