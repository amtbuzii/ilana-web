// Theme context — defines three color schemes (blue / green / light) and a toggle hook.
import { createContext, useContext, useState, useEffect } from 'react'

export const THEMES = {
  blue: {
    name: 'BLUE',
    font: 'system-ui, sans-serif',
    fontSize: 14,
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
    fontSize: 14,
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
  light: {
    name: 'LIGHT',
    font: 'system-ui, sans-serif',
    fontSize: 15,
    bg0: '#ffffff',
    bg1: '#f8f8f8',
    bg2: '#f0f0f0',
    bg3: '#e8e8e8',
    bg4: '#e0e0e0',
    bg5: '#f5f5f5',
    border0: '#cccccc',
    border1: '#1a5490',
    border2: '#999999',
    text0: '#1a1a1a',
    text1: '#333333',
    text2: '#555555',
    text3: '#888888',
    accent: '#1a5490',
    accent2: '#6b5290',
    warn: '#cc0000',
    ok: '#008000',
    caution: '#ff6600',
    btnBg: '#1a5490',
    btnBgDisabled: '#cccccc',
    btnText: '#ffffff',
    btnTextDisabled: '#666666',
    atfOk: '#008000',
    mapFilter: 'brightness(1.1)',
  },
}

const ThemeContext = createContext({ t: THEMES.blue, themeName: 'blue', toggle: () => {} })

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => localStorage.getItem('themeName') || 'blue')
  const t = THEMES[themeName]

  useEffect(() => {
    localStorage.setItem('themeName', themeName)
    document.documentElement.setAttribute('data-theme', themeName)
    document.body.style.background = t.bg0
    document.body.style.fontFamily = t.font
    document.body.style.color = t.text0
    document.body.style.fontSize = `${t.fontSize}px`
  }, [themeName, t])

  const toggle = () => setThemeName(n => n === 'blue' ? 'green' : n === 'green' ? 'light' : 'blue')

  return (
    <ThemeContext.Provider value={{ t, themeName, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
