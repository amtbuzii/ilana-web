/**
 * UTM waypoint entry modal.
 * Each row has its own zone + N-prefix + 6-digit easting + 6-digit northing.
 * Auto-advances: easting[6] → northing; northing[6] → next easting (new row).
 * All conversions run in parallel on OK.
 */
import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../theme.jsx'
import { utmToLatLon, fetchElevation } from '../api.js'

const EMPTY_ROW = () => ({ zone: '36', n: '3', east: '', north: '' })

export default function UtmEntryModal({ onClose, onConfirm, aglOffset, defaultSpeed, defaultOat, defaultOatAuto }) {
  const { t } = useTheme()
  const [rows,    setRows]    = useState([EMPTY_ROW()])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const eastRefs  = useRef([])
  const northRefs = useRef([])

  useEffect(() => { eastRefs.current[0]?.focus() }, [])

  const updateRow = (i, patch) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  const setEast = (i, val) => {
    if (!/^\d*$/.test(val) || val.length > 6) return
    updateRow(i, { east: val })
    if (val.length === 6) northRefs.current[i]?.focus()
  }

  const setNorth = (i, val) => {
    if (!/^\d*$/.test(val) || val.length > 6) return
    updateRow(i, { north: val })
    if (val.length === 6) {
      if (i === rows.length - 1) {
        setRows(r => [...r, { ...EMPTY_ROW(), zone: r[i].zone, n: r[i].n }])
        setTimeout(() => eastRefs.current[i + 1]?.focus(), 30)
      } else {
        eastRefs.current[i + 1]?.focus()
      }
    }
  }

  const removeRow = i => {
    if (rows.length === 1) return
    setRows(r => r.filter((_, idx) => idx !== i))
  }

  const handleOk = async () => {
    const valid = rows.filter(r => r.east.length === 6 && r.north.length === 6)
    if (valid.length === 0) { setError('Enter at least one complete waypoint — easting and northing must each be 6 digits'); return }
    setLoading(true); setError(null)
    try {
      // Convert all UTM → lat/lon in parallel
      const coords = await Promise.all(valid.map(r =>
        utmToLatLon(parseInt(r.zone) || 36, parseInt(r.east), parseInt((r.n || '3') + r.north))
      ))
      // Fetch elevations in parallel
      const elevations = await Promise.all(coords.map(({ lat, lon }) =>
        fetchElevation(lat, lon).catch(() => ({ elevation_ft: 0 }))
      ))
      const wpts = coords.map(({ lat, lon }, i) => {
        const elev = elevations[i]?.elevation_ft ?? 0
        return {
          name: `WP${i + 1}`,
          lat: String(lat), lon: String(lon),
          alt_ft: String(Math.round(elev + (aglOffset || 1000))),
          surface_alt_ft: String(Math.round(elev)),
          airspeed_kts: String(defaultSpeed ?? 120),
          oat_c: String(defaultOat ?? 25),
          oat_auto: defaultOatAuto ?? true,
          atf: '1.0',
          hold_type: null, hold_min: '5', hold_speed_kts: '80',
          spare_pct: '0', wind_dir: '0', wind_speed_kts: '0',
          tot_time: '', tot_mode: 'daytime',
        }
      })
      onConfirm(wpts)
    } catch (e) {
      setError('Could not convert UTM coordinates — check zone/easting/northing values or try again. ' + e.message)
      setLoading(false)
    }
  }

  const cellInput = (value, onChange, placeholder, width, ref) => ({
    ref,
    value,
    onChange: e => onChange(e.target.value),
    placeholder,
    maxLength: placeholder.length,
    style: {
      width, padding: '4px 4px', fontSize: 12,
      fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1,
      background: t.bg0, border: `1px solid ${t.border1}`,
      borderRadius: 3, color: t.text0, outline: 'none',
    },
  })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bg1, border: `1px solid ${t.border1}`,
        borderRadius: 8, width: 420, fontFamily: t.font, overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${t.border0}`, background: t.bg2,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: t.text1, letterSpacing: 2 }}>✎ UTM ENTRY</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.text3, fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '20px 36px 24px 72px 72px 18px',
          gap: 5, alignItems: 'center',
          padding: '6px 14px 4px', borderBottom: `1px solid ${t.border0}`,
        }}>
          {['#', 'ZONE', 'N', 'EASTING', 'NORTHING', ''].map(h => (
            <span key={h} style={{ fontSize: 8, color: t.text3, textAlign: 'center', letterSpacing: 1 }}>{h}</span>
          ))}
        </div>

        {/* Waypoint rows */}
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '6px 14px' }}>
          {rows.map((row, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '20px 36px 24px 72px 72px 18px',
              gap: 5, alignItems: 'center', marginBottom: 5,
            }}>
              <span style={{ fontSize: 9, color: t.text3, textAlign: 'right' }}>{i + 1}</span>

              <input
                value={row.zone}
                onChange={e => updateRow(i, { zone: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                placeholder="36"
                maxLength={2}
                style={{ width: 36, padding: '4px 4px', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', background: t.bg0, border: `1px solid ${t.border1}`, borderRadius: 3, color: t.text0, outline: 'none' }}
              />

              <input
                value={row.n}
                onChange={e => updateRow(i, { n: e.target.value.replace(/\D/g, '').slice(0, 1) })}
                placeholder="3"
                maxLength={1}
                style={{ width: 24, padding: '4px 2px', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', background: t.bg0, border: `1px solid ${t.border1}`, borderRadius: 3, color: t.text0, outline: 'none' }}
              />

              <input
                ref={el => { eastRefs.current[i] = el }}
                value={row.east}
                onChange={e => setEast(i, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && row.east.length === 6) northRefs.current[i]?.focus() }}
                placeholder="000000"
                maxLength={6}
                style={{ width: 72, padding: '4px 4px', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 2, background: t.bg0, border: `1px solid ${t.border1}`, borderRadius: 3, color: t.text0, outline: 'none' }}
              />

              <input
                ref={el => { northRefs.current[i] = el }}
                value={row.north}
                onChange={e => setNorth(i, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && row.north === '' && row.east === '' && rows.length > 1) {
                    removeRow(i)
                    setTimeout(() => northRefs.current[i - 1]?.focus(), 30)
                  }
                  if (e.key === 'Enter' && row.north.length === 6) {
                    if (i === rows.length - 1) {
                      setRows(r => [...r, { ...EMPTY_ROW(), zone: r[i].zone, n: r[i].n }])
                      setTimeout(() => eastRefs.current[i + 1]?.focus(), 30)
                    } else {
                      eastRefs.current[i + 1]?.focus()
                    }
                  }
                }}
                placeholder="000000"
                maxLength={6}
                style={{ width: 72, padding: '4px 4px', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 2, background: t.bg0, border: `1px solid ${t.border1}`, borderRadius: 3, color: t.text0, outline: 'none' }}
              />

              <button onClick={() => removeRow(i)} disabled={rows.length === 1} style={{
                background: 'none', border: 'none', color: rows.length > 1 ? t.text3 : 'transparent',
                fontSize: 11, cursor: rows.length > 1 ? 'pointer' : 'default', padding: 0,
              }}>✕</button>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ padding: '4px 14px', fontSize: 10, color: t.warn }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: `1px solid ${t.border0}` }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '7px 0', fontSize: 10, fontWeight: 700,
            cursor: 'pointer', fontFamily: t.font, borderRadius: 4,
            background: 'none', border: `1px solid ${t.border0}`, color: t.text3,
          }}>CANCEL</button>
          <button onClick={handleOk} disabled={loading} style={{
            flex: 2, padding: '7px 0', fontSize: 10, fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer', fontFamily: t.font, borderRadius: 4,
            background: t.accent + '22', border: `1px solid ${t.accent}`, color: t.accent,
            opacity: loading ? 0.6 : 1,
          }}>{loading ? 'CONVERTING…' : 'OK — ADD WAYPOINTS'}</button>
        </div>
      </div>
    </div>
  )
}
