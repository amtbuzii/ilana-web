// WCA panel — 3-column layout: WARNING | CAUTION | ADVISORY
// WARNING and CAUTION come from stopAlert (simulation result).
// ADVISORY comes from per-waypoint evaluate_wca alerts.
import { useTheme } from '../theme.jsx'

export default function WcaPanel({
  alerts = [],
  stopAlert = null,
  advisoriesEnabled = true,
  onOpenWca,
}) {
  const { t } = useTheme()

  const warnings  = stopAlert?.level === 'WARNING'  ? [stopAlert] : []
  const cautions  = stopAlert?.level === 'CAUTION'  ? [stopAlert] : []
  const advisories = alerts.filter(a => a.level === 'ADVISORY')

  if (!stopAlert && advisories.length === 0) return null

  const hasWarning = warnings.length > 0

  const COLS = [
    { level: 'WARNING',  icon: '⚠', color: t.warn,    items: warnings,   enabled: true },
    { level: 'CAUTION',  icon: '◆', color: t.caution, items: cautions,   enabled: true },
    { level: 'ADVISORY', icon: 'ℹ', color: t.accent,  items: advisories, enabled: advisoriesEnabled },
  ]

  return (
    <div style={{
      margin: '0 0 8px', borderRadius: 4, fontFamily: t.font, overflow: 'hidden',
      border: `1px solid ${hasWarning ? t.warn : t.border0}`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
        borderBottom: `1px solid ${t.border0}`,
        background: hasWarning ? t.warn + '18' : t.bg3,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2,
          color: hasWarning ? t.warn : t.text1 }}>WCA</span>
        <div style={{ display: 'flex', gap: 5, flex: 1 }}>
          {warnings.length  > 0 && <Pill color={t.warn}    label={`${warnings.length} WARN`} />}
          {cautions.length  > 0 && <Pill color={t.caution} label={`${cautions.length} CAUT`} />}
          {advisories.length > 0 && <Pill color={t.accent}  label={`${advisories.length} ADV`} />}
        </div>
        {onOpenWca && (
          <button onClick={onOpenWca} style={{
            padding: '1px 8px', fontSize: 8, fontWeight: 700, cursor: 'pointer',
            fontFamily: t.font, borderRadius: 3,
            background: 'none', border: `1px solid ${t.border0}`, color: t.text3,
          }}>⚙ CONFIG</button>
        )}
      </div>

      {/* 3-column body */}
      <div style={{ display: 'flex', minHeight: 0 }}>
        {COLS.map(({ level, icon, color, items, enabled }, ci) => {
          const borderLeft = ci > 0 ? `1px solid ${t.border0}` : 'none'
          return (
            <div key={level} style={{
              flex: 1, borderLeft,
              background: items.length > 0 && enabled ? color + '08' : 'transparent',
              opacity: enabled ? 1 : 0.5,
            }}>
              {/* Column header */}
              <div style={{
                padding: '4px 8px', borderBottom: `1px solid ${t.border0}`,
                background: items.length > 0 ? color + '18' : t.bg2,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: items.length > 0 ? color : t.text3, letterSpacing: 1 }}>
                  {icon} {level}
                </span>
                {items.length > 0 && (
                  <span style={{
                    fontSize: 8, fontWeight: 700, marginLeft: 'auto',
                    background: color + '28', color, borderRadius: 8, padding: '0 5px',
                  }}>{items.length}</span>
                )}
                {!enabled && <span style={{ fontSize: 8, color: t.text3, marginLeft: 2 }}>(off)</span>}
              </div>

              {/* Alert rows */}
              <div style={{ padding: '4px 0' }}>
                {items.length === 0 ? (
                  <div style={{ padding: '4px 8px', fontSize: 9, color: t.text3, fontStyle: 'italic' }}>—</div>
                ) : items.map((a, idx) => (
                  <div key={idx} style={{
                    padding: '3px 8px',
                    borderLeft: `2px solid ${enabled ? color : t.border0}`,
                    marginLeft: 4, marginBottom: 2,
                    background: enabled ? color + '10' : 'transparent',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: t.text3, marginBottom: 1 }}>
                      {a.wpt_name ?? 'MID-LEG'}
                    </div>
                    <div style={{ fontSize: 9, color: t.text1, lineHeight: 1.4 }}>{a.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ color, label }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: '1px 6px',
      borderRadius: 10, background: color + '28', color, letterSpacing: 0.3,
    }}>{label}</span>
  )
}
