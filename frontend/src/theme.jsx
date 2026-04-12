// Theme context — defines the two color schemes (blue / green) and a toggle hook.
import { createContext, useContext, useState, useEffect } from 'react'

export const THEMES = {
  blue: {
    name: 'BLUE',
    font: 'system-ui, sans-serif',
    bg0: '#0d0f1a',
    bg1: '#1a1d27',
    bg2: '#13151f',
    bg3: '#0f1117',
    bg4: '#1e2a45',
    bg5: '#0a0c14',
    border0: '#2d3148',
    border1: '#2563eb',
    border2: '#1e2130',
    text0: '#e2e8f0',
    text1: '#94a3b8',
    text2: '#64748b',
    text3: '#475569',
    accent: '#60a5fa',
    accent2: '#a78bfa',
    warn: '#f87171',
    ok: '#4ade80',
    caution: '#facc15',
    btnBg: '#2563eb',
    btnBgDisabled: '#2d3148',
    btnText: '#ffffff',
    btnTextDisabled: '#64748b',
    atfOk: '#4ade80',
    mapFilter: 'none',
  },
  green: {
    name: 'GREEN',
    font: "'Courier New', Courier, monospace",
    bg0: '#000000',
    bg1: '#000000',
    bg2: '#000500',
    bg3: '#000500',
    bg4: '#001a00',
    bg5: '#000a00',
    border0: '#004400',
    border1: '#00ff41',
    border2: '#002200',
    text0: '#00ff41',
    text1: '#00cc33',
    text2: '#008811',
    text3: '#005500',
    accent: '#00ff41',
    accent2: '#00cc33',
    warn: '#ff3333',
    ok: '#00ff41',
    caution: '#ffff00',
    btnBg: '#002800',
    btnBgDisabled: '#001400',
    btnText: '#00ff41',
    btnTextDisabled: '#005500',
    atfOk: '#00ff41',
    mapFilter: 'grayscale(1) brightness(0.55) hue-rotate(90deg) saturate(4)',
  },
}

const ThemeContext = createContext({ t: THEMES.green, themeName: 'green', toggle: () => {} })

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState('blue')
  const t = THEMES[themeName]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeName)
    document.body.style.background = t.bg0
    document.body.style.fontFamily = t.font
    document.body.style.color = t.text0
  }, [themeName, t])

  const toggle = () => setThemeName(n => n === 'green' ? 'blue' : 'green')

  return (
    <ThemeContext.Provider value={{ t, themeName, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
