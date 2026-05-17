// Waypoint panel — list, reorder, and edit individual waypoints with UTM/GEO coordinate entry.
import { useState, useEffect, useRef } from 'react'
import { utmToLatLon, fetchElevation, latLonToUtm } from '../api.js'
import { useTheme } from '../theme.jsx'
import { useExplanations } from '../useExplanations.js'

export default function WaypointPanel({ waypoints, activeWpt, onSelect, onUpdate, onAdd, onRemove, onReorder, onReverse, aglOffset = 1000, altMode = 'AGL', seaLevelTemp = 25, targetWptIdx, onSetTarget, cspWptIdx, cspFuel, onSetCsp, onCspFuelChange, onCspAutoOge, onCspAutoIge, selectedWpts = new Set(), onSetSelectedWpts = () => {} }) {
  const { t } = useTheme()
  const { get } = useExplanations()
  // Shared ref so dragging state survives across card re-renders
  const dragFromRef = useRef(null)

  const toggleSelect = (i) => {
    onSetSelectedWpts(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  const selectAll = () => onSetSelectedWpts(new Set(waypoints.map((_, i) => i)))
  const clearSelect = () => onSetSelectedWpts(new Set())
  const deleteSelected = () => {
    const indicesToDelete = Array.from(selectedWpts).sort((a, b) => b - a)
    indicesToDelete.forEach(i => onRemove(i))
    clearSelect()
  }

  return (
    <div style={{ fontFamily: t.font }}>
      <div style={{ borderBottom: `1px solid ${t.border0}`, padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        {/* Left side: All/Cancel/Delete buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {selectedWpts.size > 0 ? (
            <>
              <button
                onClick={() => deleteSelected()}
                title={get('DELETE')}
                style={{
                  padding: '6px 12px', fontSize: 12, background: t.warn,
                  color: t.bg0, border: `1px solid ${t.warn}`, borderRadius: 4,
                  cursor: 'pointer', fontFamily: t.font, letterSpacing: 1, fontWeight: 600,
                }}
              >🗑 DELETE</button>
              <button
                onClick={clearSelect}
                title={get('CANCEL')}
                style={{
                  padding: '6px 12px', fontSize: 12, background: t.bg4,
                  color: t.text2, border: `1px solid ${t.border0}`, borderRadius: 4,
                  cursor: 'pointer', fontFamily: t.font, letterSpacing: 1, fontWeight: 600,
                }}
              >✕ CANCEL</button>
            </>
          ) : (
            <button
              onClick={selectAll}
              title={get('ALL')}
              style={{
                padding: '6px 12px', fontSize: 12, background: t.bg4,
                color: t.text2, border: `1px solid ${t.border0}`, borderRadius: 4,
                cursor: 'pointer', fontFamily: t.font, letterSpacing: 1, fontWeight: 600,
              }}
            >☑ ALL</button>
          )}
        </div>

        {/* Right side: REV + ADD */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={onReverse}
            title={get('REV')}
            style={{
              padding: '6px 12px', fontSize: 12, background: t.bg4,
              color: t.text2, border: `1px solid ${t.border0}`, borderRadius: 4,
              cursor: 'pointer', fontFamily: t.font, letterSpacing: 1, fontWeight: 600,
            }}
          >⇅ REV</button>

          <button
            onClick={onAdd}
            title={get('ADD')}
            style={{
              padding: '6px 12px', fontSize: 12, background: t.bg4,
              color: t.accent, border: `1px solid ${t.border1}`, borderRadius: 4,
              cursor: 'pointer', fontFamily: t.font, letterSpacing: 1, fontWeight: 600,
            }}
          >+ ADD</button>
        </div>
      </div>
      {waypoints.map((wp, i) => (
        <WaypointCard
          key={i} index={i} wp={wp}
          isActive={activeWpt === i}
          isTarget={targetWptIdx === i}
          isCsp={cspWptIdx === i}
          isSelected={selectedWpts.has(i)}
          cspFuel={cspFuel}
          onSelect={() => onSelect(i === activeWpt ? null : i)}
          onToggleSelect={() => toggleSelect(i)}
          onUpdate={(field, val) => onUpdate(i, field, val)}
          onRemove={() => onRemove(i)}
          onSetTarget={() => onSetTarget?.(i)}
          onSetCsp={() => onSetCsp?.(i)}
          onCspFuelChange={onCspFuelChange}
          onCspAutoOge={onCspAutoOge}
          onCspAutoIge={onCspAutoIge}
          aglOffset={aglOffset}
          altMode={altMode}
          seaLevelTemp={seaLevelTemp}
          dragFromRef={dragFromRef}
          onReorder={onReorder}
        />
      ))}
    </div>
  )
}

function WaypointCard({ index, wp, isActive, isTarget, isCsp, isSelected, cspFuel, onSelect, onToggleSelect, onUpdate, onRemove, onSetTarget, onSetCsp, onCspFuelChange, onCspAutoOge, onCspAutoIge, aglOffset = 1000, altMode = 'AGL', seaLevelTemp = 25, dragFromRef, onReorder }) {
  const { t } = useTheme()
  const [utmMode, setUtmMode]           = useState(true)
  const [utm, setUtm]                   = useState({ zone: '36', easting: '', northingPfx: '', northingRest: '' })
  const [utmErr, setUtmErr]             = useState('')
  const [derivedUtm, setDerivedUtm]     = useState(null)
  const [isDragOver, setIsDragOver]     = useState(false)
  const [surfaceAltAuto, setSurfaceAltAuto] = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
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
        if (!cancelled) setUtmErr('Invalid UTM — check zone, easting, and northing')
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
    borderRadius: 3, padding: '3px 5px', color: t.text0, fontSize: 12,
    fontFamily: t.font, boxSizing: 'border-box',
  }

  // Fetch elevation for current position and refresh surface alt, alt ft, and OAT
  const handleRefresh = async () => {
    const lat = parseFloat(wp.lat)
    const lon = parseFloat(wp.lon)
    if (isNaN(lat) || isNaN(lon)) return
    setRefreshing(true)
    try {
      const { elevation_ft } = await fetchElevation(lat, lon)
      const newAlt = altMode === 'MSL' ? aglOffset : Math.round(elevation_ft + aglOffset)
      onUpdate('surface_alt_ft', String(Math.round(elevation_ft)))
      setSurfaceAltAuto(true)
      onUpdate('alt_ft', String(newAlt))
      const newOat = Math.round(((seaLevelTemp) - (newAlt / 1000) * 1.98) * 10) / 10
      onUpdate('oat_c', String(newOat))
      onUpdate('oat_auto', true)
    } catch {
      // silently ignore — elevation service not available
    } finally {
      setRefreshing(false)
    }
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
        border: `1px solid ${isSelected ? t.accent : isDragOver ? t.accent : isActive ? t.border1 : t.border0}`,
        background: isSelected ? t.accent + '11' : isDragOver ? t.bg4 : isActive ? t.bg4 : t.bg2,
        overflow: 'hidden',
        opacity: isDragOver ? 0.85 : 1,
      }}
    >
      {/* Card header — always visible */}
      <div onClick={onSelect} style={{ padding: '7px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={e => { e.stopPropagation(); onToggleSelect() }}
            onClick={e => e.stopPropagation()}
            style={{ cursor: 'pointer', width: 16, height: 16 }}
          />
          <span
            onMouseDown={e => e.stopPropagation()}
            style={{ color: t.text3, fontSize: 13, cursor: 'grab', userSelect: 'none', lineHeight: 1 }}
            title="Drag to reorder"
          >⠿</span>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: isActive ? t.border1 : t.border2,
            border: `1px solid ${isActive ? t.border1 : t.border0}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: isActive ? t.bg0 : t.text1, flexShrink: 0,
          }}>{index + 1}</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? t.text0 : t.text1, letterSpacing: 1 }}>
            {wp.name || `WP${index + 1}`}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onSetTarget() }}
            title={isTarget ? 'Clear TOT' : 'Set Time on Target'}
            style={{
              padding: '2px 7px', fontSize: 12, borderRadius: 3, cursor: 'pointer',
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
              padding: '2px 7px', fontSize: 12, borderRadius: 3, cursor: 'pointer',
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
              <div style={{ fontSize: 11, color: t.text2 }}>
                {parseFloat(wp.lat).toFixed(4)}° {parseFloat(wp.lon).toFixed(4)}°
              </div>
              {derivedUtm && (() => {
                const ns = String(Math.round(derivedUtm.northing))
                return <div style={{ fontSize: 10, color: t.text3 }}>{derivedUtm.zone} · {Math.round(derivedUtm.easting)} · {ns[0]} · {ns.slice(1)}</div>
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
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${t.border0}`, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* ── NAME ── */}
          <div>
            <FL t={t}>NAME</FL>
            <input
              value={wp.name || ''}
              maxLength={25}
              onChange={e => onUpdate('name', e.target.value)}
              placeholder={`WP${index + 1}`}
              style={{ ...si, width: '100%' }}
            />
          </div>

          {/* ── Coordinates ── */}
          <div style={{ background: t.bg2, borderRadius: 5, border: `1px solid ${t.border0}`, padding: '8px 10px' }}>
            {/* UTM / GEO segmented toggle */}
            <div style={{ display: 'flex', marginBottom: 8, borderRadius: 4, overflow: 'hidden', border: `1px solid ${t.border0}` }}>
              {[['UTM', true, switchToUtm], ['GEO', false, () => { setUtmErr(''); setUtmMode(false) }]].map(([label, active, fn]) => (
                <button key={label} onClick={fn} style={{
                  flex: 1, padding: '5px 0', fontSize: 11, border: 'none',
                  borderRight: label === 'UTM' ? `1px solid ${t.border0}` : 'none',
                  cursor: 'pointer',
                  background: (utmMode === active) ? t.border1 : t.bg3,
                  color: (utmMode === active) ? '#fff' : t.text2,
                  fontFamily: t.font, letterSpacing: 2, fontWeight: 700,
                }}>{label}</button>
              ))}
            </div>

            {utmMode ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <FL t={t}>ZONE</FL>
                  <input
                    value={utm.zone}
                    maxLength={2}
                    onChange={e => setUtm(u => ({...u, zone: e.target.value.replace(/\D/g, '').slice(0, 2)}))}
                    placeholder="36"
                    style={{ ...si, width: 34, textAlign: 'center' }}
                  />
                </div>
                <div>
                  <FL t={t}>N</FL>
                  <input
                    value={utm.northingPfx}
                    maxLength={1}
                    onChange={e => setUtm(u => ({...u, northingPfx: e.target.value.replace(/\D/g, '').slice(0, 1)}))}
                    placeholder="3"
                    style={{ ...si, width: 26, textAlign: 'center' }}
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
                      if (val.length === 6) northingRestRef.current?.focus()
                    }}
                    placeholder="674335"
                    style={{ ...si, width: 64 }}
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
                    style={{ ...si, width: 64 }}
                  />
                </div>
                {utmErr && <span style={{ color: t.warn, fontSize: 11, alignSelf: 'flex-end', paddingBottom: 3 }}>{utmErr}</span>}
                <UpdateBtn t={t} refreshing={refreshing} disabled={!wp.lat || !wp.lon} onClick={handleRefresh} />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FL t={t}>LAT</FL>
                  <input
                    value={wp.lat}
                    maxLength={10}
                    onChange={e => onUpdate('lat', e.target.value)}
                    placeholder="32.0853"
                    style={{ ...si, width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FL t={t}>LON</FL>
                  <input
                    value={wp.lon}
                    maxLength={10}
                    onChange={e => onUpdate('lon', e.target.value)}
                    placeholder="34.7818"
                    style={{ ...si, width: '100%' }}
                  />
                </div>
                <UpdateBtn t={t} refreshing={refreshing} disabled={!wp.lat || !wp.lon} onClick={handleRefresh} />
              </div>
            )}
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
              <div style={{ background: t.bg2, borderRadius: 5, border: `1px solid ${t.border0}`, padding: '8px 10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                  <div>
                    <FL t={t}>ALT FT</FL>
                    {numInput('alt_ft', wp.alt_ft, 6, { placeholder: '1000', allowNeg: true, min: -2000, max: 12000, width: '100%', style: { width: '100%' } })}
                    {belowTerrain && (
                      <div style={{ fontSize: 10, color: t.warn, marginTop: 3, letterSpacing: 0.5 }}>
                        ⚠ BELOW DSM · surf {surfAlt} ft
                      </div>
                    )}
                    {nearTerrain && (
                      <div style={{ fontSize: 10, color: t.caution, marginTop: 3, letterSpacing: 0.5 }}>
                        ◆ NEAR DSM · +{Math.round(userAlt - surfAlt)} ft clr
                      </div>
                    )}
                  </div>
                  <div>
                    <FL t={t}>SURFACE{altMode === 'MSL' ? ' *' : ''}</FL>
                    <input
                      value={wp.surface_alt_ft ?? ''}
                      maxLength={5}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 5)
                        setSurfaceAltAuto(false)
                        onUpdate('surface_alt_ft', v)
                      }}
                      placeholder="DSM"
                      style={{ ...si, width: '100%', color: surfaceAltAuto ? t.text2 : t.text0 }}
                    />
                  </div>
                  <div>
                    <FL t={t}>TAS KTS</FL>
                    {numInput('airspeed_kts', wp.airspeed_kts, 3, { placeholder: '120', min: 0, max: 150, style: { width: '100%' } })}
                  </div>
                  <div>
                    <FL t={t}>OAT °C{wp.oat_auto ? <span style={{ color: t.ok, fontSize: 10, marginLeft: 4 }}>ELR</span> : null}</FL>
                    {numInput('oat_c', wp.oat_c, 3, { placeholder: '25', allowNeg: true, min: -15, max: 50, style: { width: '100%' } })}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── Wind ── */}
          <div style={{ background: t.bg2, borderRadius: 5, border: `1px solid ${t.border0}`, padding: '8px 10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
              <div>
                <FL t={t}>WIND DIR °</FL>
                {numInput('wind_dir', wp.wind_dir, 3, { placeholder: '0', min: 0, max: 360, style: { width: '100%' } })}
              </div>
              <div>
                <FL t={t}>WIND SPEED KTS</FL>
                {numInput('wind_speed_kts', wp.wind_speed_kts, 3, { placeholder: '0', min: 0, max: 50, style: { width: '100%' } })}
              </div>
            </div>
          </div>

          {/* ── Hold / waiting ── */}
          <div style={{ background: t.bg2, borderRadius: 5, border: `1px solid ${t.border0}`, padding: '8px 10px' }}>
            <FL t={t}>HOLD / WAITING</FL>
            <div style={{ display: 'flex', gap: 5, marginBottom: wp.hold_type ? 8 : 0 }}>
              {[['ground','GND'],['hover','HOVER'],['endurance','ENDURANCE']].map(([type, label]) => {
                const active = wp.hold_type === type
                return (
                  <button key={type} onClick={() => onUpdate('hold_type', active ? null : type)} style={{
                    flex: 1, padding: '5px 4px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                    fontFamily: t.font, fontWeight: 700, letterSpacing: 1,
                    background: active ? t.caution + '22' : t.bg3,
                    color: active ? t.caution : t.text3,
                    border: `1px solid ${active ? t.caution : t.border0}`,
                  }}>{label}</button>
                )
              })}
            </div>
            {wp.hold_type && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    value={wp.hold_min ?? '5'}
                    maxLength={3}
                    onChange={e => onUpdate('hold_min', e.target.value.replace(/\D/g, '').slice(0, 3))}
                    style={{ width: 44, background: t.bg3, border: `1px solid ${t.caution}`, borderRadius: 3, padding: '4px 6px', color: t.caution, fontSize: 12, fontFamily: t.font, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: t.text3 }}>MIN</span>
                </div>
                {wp.hold_type === 'endurance' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      value={wp.hold_speed_kts ?? '80'}
                      maxLength={3}
                      onChange={e => onUpdate('hold_speed_kts', e.target.value.replace(/\D/g, '').slice(0, 3))}
                      style={{ width: 44, background: t.bg3, border: `1px solid ${t.border0}`, borderRadius: 3, padding: '4px 6px', color: t.text0, fontSize: 12, fontFamily: t.font, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: t.text3 }}>KTS</span>
                  </div>
                )}
                <span style={{ fontSize: 11, color: t.text3, fontStyle: 'italic' }}>
                  {wp.hold_type === 'ground'   ? 'FF = 475 lb/hr' :
                   wp.hold_type === 'hover'    ? 'FF from OGE torque' :
                                                 'FF at endurance speed'}
                </span>
              </div>
            )}
          </div>

          {/* ── Spare % ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <FL t={t}>SPARE %</FL>
              {numInput('spare_pct', wp.spare_pct, 3, { placeholder: '0', allowNeg: true, min: -5, max: 40 })}
            </div>
            <div style={{ paddingTop: 16 }}>
              <span style={{ fontSize: 11, color: t.text3, fontStyle: 'italic' }}>
                −5 to +40 · applies onwards
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
  return <div style={{ fontSize: 11, color: t.text3, marginBottom: 3, letterSpacing: 1 }}>{children}</div>
}

// Small inline UPDATE button used inside the coordinate block
function UpdateBtn({ t, refreshing, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={refreshing || disabled}
      title="Refresh surface alt, alt ft and OAT from current position"
      style={{
        flexShrink: 0, alignSelf: 'flex-end',
        padding: '3px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1,
        borderRadius: 3, cursor: (refreshing || disabled) ? 'default' : 'pointer',
        fontFamily: t.font,
        background: refreshing ? t.bg3 : t.bg4,
        color: refreshing ? t.text3 : t.accent,
        border: `1px solid ${refreshing ? t.border0 : t.border1}`,
        opacity: disabled ? 0.4 : 1,
      }}
    >{refreshing ? '…' : '↻'}</button>
  )
}
