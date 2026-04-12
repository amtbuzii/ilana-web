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

export default function RoutePanel({
  width = 230,
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
  // Two-step delete: first click arms the confirm button, second click commits
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [dragOverId,      setDragOverId]      = useState(null)
  const dragFromIdRef = useRef(null)
  // Hidden file inputs triggered by the import buttons
  const importJsonRef = useRef(null)
  const importXlsRef  = useRef(null)

  const smallBtn = {
    fontSize: 9, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
    fontFamily: t.font, border: 'none', background: 'none',
  }
  const ctrlBtn = {
    fontSize: 13, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
    fontFamily: t.font, border: 'none', background: 'none', lineHeight: 1,
  }

  return (
    <div style={{
      width, background: t.bg1, display: 'flex', flexDirection: 'column',
      flexShrink: 0, borderLeft: `1px solid ${t.border0}`, fontFamily: t.font,
    }}>
      {/* ── Project name ── */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${t.border0}`, background: t.bg0 }}>
        <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2, marginBottom: 3 }}>PROJECT</div>
        {editingProject ? (
          <input
            autoFocus
            value={projectName}
            onChange={e => onSetProjectName(e.target.value)}
            onBlur={() => { setEditingProject(false); if (!projectName.trim()) onSetProjectName('Ilana') }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() }}
            style={{
              width: '100%', background: t.bg3, border: `1px solid ${t.accent}`, borderRadius: 3,
              color: t.accent, fontFamily: t.font, fontSize: 13, fontWeight: 700,
              padding: '2px 6px', outline: 'none', letterSpacing: 1, boxSizing: 'border-box',
            }}
          />
        ) : (
          <div
            onClick={() => setEditingProject(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: t.accent, letterSpacing: 1 }}>{projectName}</span>
            <span style={{ fontSize: 9, color: t.text3 }}>✎</span>
          </div>
        )}
      </div>

      {/* ── Route list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px 5px',
        }}>
          <span style={{ fontSize: 9, color: t.text3, letterSpacing: 2 }}>ROUTES {routes.length}/10</span>
          {routes.length < 10 && (
            <button
              onClick={onAdd}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                fontFamily: t.font, letterSpacing: 0.5,
                background: t.bg4, border: `1px solid ${t.border1}`, color: t.accent,
              }}
            >+ NEW</button>
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
                padding: '5px 12px', cursor: 'pointer',
                background: dragOverId === route.id ? t.bg3 : isActive ? t.bg4 : 'transparent',
                // Colored left stripe shows active route's color
                borderLeft: `3px solid ${isActive ? route.color : 'transparent'}`,
                // Top border highlights the drag-over drop target
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
                    fontSize: 11, padding: '1px 5px', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 10, color: t.text3, cursor: 'grab', lineHeight: 1, flexShrink: 0 }}>⠿</span>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: route.color, flexShrink: 0,
                    opacity: route.visible ? 1 : 0.3,
                  }} />
                  <button
                    onClick={e => { e.stopPropagation(); onToggleVisible(route.id) }}
                    title={route.visible ? 'Hide on map' : 'Show on map'}
                    style={{ ...smallBtn, padding: '0 2px', display: 'flex', alignItems: 'center' }}
                  ><EyeIcon open={route.visible} color={route.visible ? t.accent : t.text3} /></button>
                  <span style={{
                    flex: 1, fontSize: 11,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? t.text0 : t.text2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    opacity: route.visible ? 1 : 0.5,
                  }}>{route.name}</span>
                  {/* Per-route action buttons — stop propagation so row click doesn't activate the route */}
                  <div style={{ display: 'flex', gap: 1 }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setEditingId(route.id); setEditName(route.name) }}
                      title="Rename"
                      style={{ ...ctrlBtn, color: t.text3 }}
                    >✎</button>
                    <button
                      onClick={() => onDuplicate(route.id)}
                      title="Duplicate route"
                      style={{ ...ctrlBtn, color: t.text3, opacity: routes.length >= 10 ? 0.3 : 1 }}
                      disabled={routes.length >= 10}
                    >⧉</button>
                    {routes.length > 1 && (
                      confirmDeleteId === route.id ? (
                        <>
                          <button
                            onClick={() => { onDelete(route.id); setConfirmDeleteId(null) }}
                            style={{ ...ctrlBtn, fontSize: 10, color: t.bg0, background: t.warn, borderRadius: 3, padding: '1px 5px' }}
                          >DEL</button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            style={{ ...ctrlBtn, fontSize: 10, color: t.text2 }}
                          >✕</button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(route.id)}
                          title="Delete route"
                          style={{ ...ctrlBtn, color: t.warn }}
                        >🗑</button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Visibility bulk controls ── */}
      {(() => {
        const allVisible  = routes.every(r => r.visible)
        const noneVisible = routes.every(r => !r.visible)
        return (
          <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderTop: `1px solid ${t.border0}`, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: t.text3, letterSpacing: 1, flex: 1 }}>VISIBILITY</span>
            <button
              onClick={onShowAll}
              title="Show all routes"
              style={{ ...smallBtn, fontSize: 9, padding: '2px 8px', borderRadius: 3,
                color:      allVisible ? t.bg0    : t.text3,
                background: allVisible ? t.accent : 'none',
                border:     `1px solid ${allVisible ? t.accent : t.border0}`,
                fontWeight: allVisible ? 700 : 400,
              }}
            >ALL</button>
            <button
              onClick={onHideAll}
              title="Hide all routes"
              style={{ ...smallBtn, fontSize: 9, padding: '2px 8px', borderRadius: 3,
                color:      noneVisible ? t.bg0   : t.text3,
                background: noneVisible ? t.text3 : 'none',
                border:     `1px solid ${noneVisible ? t.text3 : t.border0}`,
                fontWeight: noneVisible ? 700 : 400,
              }}
            >NONE</button>
          </div>
        )
      })()}

      {/* ── Import route from file ── */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${t.border0}` }}>
        <div style={{ fontSize: 9, color: t.text3, letterSpacing: 2, marginBottom: 5 }}>INSERT ROUTE FROM</div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={() => importJsonRef.current.click()}
            style={{
              flex: 1, fontSize: 9, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, background: t.bg3, border: `1px solid ${t.border0}`, color: t.text2,
              textAlign: 'center',
            }}
          >↑ JSON</button>
          <button
            onClick={() => importXlsRef.current.click()}
            style={{
              flex: 1, fontSize: 9, padding: '4px 0', borderRadius: 3, cursor: 'pointer',
              fontFamily: t.font, background: t.bg3, border: `1px solid ${t.border0}`, color: t.text2,
              textAlign: 'center',
            }}
          >↑ EXCEL</button>
        </div>
        {/* Hidden inputs — browser file picker is opened programmatically */}
        <input ref={importJsonRef} type="file" accept=".json"        style={{ display: 'none' }} onChange={onImportJson} />
        <input ref={importXlsRef}  type="file" accept=".xlsx,.xls"  style={{ display: 'none' }} onChange={onImportExcel} />
      </div>
    </div>
  )
}
