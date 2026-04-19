// Easter egg: Reem & Aner jump game. 1P (coop) or 2P (competitive best-of-3).
// Triggered by triple-clicking the app logo. Pure canvas, fully offline.
import { useEffect, useRef, useState } from 'react'

const W = 620, H = 215
const GROUND = H - 46
const GRAVITY = 0.65
const JUMP_V = -15
const CHAR_X1 = 74    // Reem
const CHAR_X2 = 124   // Aner
const STRIP_SEP = 6   // px between 2P strips

// ── Reem: blonde boy toddler ─────────────────────────────────────────────────
function drawReem(ctx, y, frame, phase, hideNameTag = false) {
  const x = CHAR_X1
  const onGnd = y >= GROUND - 2
  const leg   = onGnd ? Math.sin(frame * 0.28) * 9 : 0
  const arm   = onGnd ? Math.sin(frame * 0.28) * 9 : 0

  ctx.save()
  ctx.translate(x, GROUND + 1); ctx.scale(1, 0.22)
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#dc2626'
  ctx.fillRect(x - 12, y - 5, 11, 6)
  ctx.fillRect(x + 1,  y - 5, 11, 6)

  ctx.fillStyle = '#93c5fd'
  ctx.save(); ctx.translate(x - 5, y - 18); ctx.rotate(leg * 0.07)
  ctx.fillRect(-5, 0, 10, 15); ctx.restore()
  ctx.save(); ctx.translate(x + 5, y - 18); ctx.rotate(-leg * 0.07)
  ctx.fillRect(-5, 0, 10, 15); ctx.restore()

  ctx.fillStyle = '#f97316'
  ctx.beginPath(); ctx.ellipse(x, y - 33, 13, 15, 0, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = '#f5cba7'
  if (!onGnd) {
    ctx.save(); ctx.translate(x - 13, y - 37); ctx.rotate(-0.75)
    ctx.fillRect(-10, -4, 10, 6); ctx.restore()
    ctx.save(); ctx.translate(x + 13, y - 37); ctx.rotate(0.75)
    ctx.fillRect(0, -4, 10, 6); ctx.restore()
  } else {
    ctx.save(); ctx.translate(x - 13, y - 34); ctx.rotate(arm * 0.06)
    ctx.fillRect(-10, -4, 10, 6); ctx.restore()
    ctx.save(); ctx.translate(x + 13, y - 34); ctx.rotate(-arm * 0.06)
    ctx.fillRect(0, -4, 10, 6); ctx.restore()
  }

  ctx.fillStyle = '#f5cba7'
  ctx.beginPath(); ctx.arc(x, y - 57, 14, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = '#fbbf24'
  ctx.beginPath(); ctx.arc(x, y - 62, 12, Math.PI + 0.1, 2 * Math.PI - 0.1); ctx.fill()
  ctx.fillRect(x - 14, y - 73, 28, 13)
  ctx.beginPath(); ctx.arc(x - 13, y - 61, 5, 0.2, Math.PI + 0.2); ctx.fill()
  ctx.beginPath(); ctx.arc(x + 13, y - 61, 5, -0.2, Math.PI - 0.2); ctx.fill()

  if (phase === 'gameover') {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2
    for (const ex of [x - 5, x + 5]) {
      ctx.beginPath(); ctx.moveTo(ex - 3, y - 61); ctx.lineTo(ex + 3, y - 55); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(ex + 3, y - 61); ctx.lineTo(ex - 3, y - 55); ctx.stroke()
    }
  } else {
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(x - 5, y - 58, 2.5, 0, Math.PI * 2)
    ctx.arc(x + 5, y - 58, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillRect(x - 6, y - 60, 1.5, 1.5)
    ctx.fillRect(x + 4, y - 60, 1.5, 1.5)
  }

  ctx.fillStyle = 'rgba(255,130,130,0.32)'
  ctx.beginPath(); ctx.arc(x - 10, y - 54, 5, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(x + 10, y - 54, 5, 0, Math.PI * 2); ctx.fill()

  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5
  if (phase === 'gameover') {
    ctx.beginPath(); ctx.arc(x, y - 49, 5, Math.PI + 0.2, 2 * Math.PI - 0.2); ctx.stroke()
  } else {
    ctx.beginPath(); ctx.arc(x, y - 50, 5, 0.1, Math.PI - 0.1); ctx.stroke()
  }

  if (!hideNameTag) {
    ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'
    const tw = ctx.measureText('Reem').width + 10
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - tw / 2, y - 89, tw, 14)
    ctx.fillStyle = '#fbbf24'; ctx.fillText('Reem', x, y - 78)
  }
}

// ── Aner: brown-haired infant (70% size of Reem) ─────────────────────────────
function drawAner(ctx, y, frame, phase) {
  const x  = CHAR_X2
  const S  = 0.70
  const sz = v => v * S
  const onGnd = y >= GROUND - 2
  const leg   = onGnd ? Math.sin(frame * 0.22) * 6 : 0

  ctx.save()
  ctx.translate(x, GROUND + 1); ctx.scale(1, 0.22)
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath(); ctx.arc(0, 0, sz(10), 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#fef9c3'
  ctx.fillRect(x - sz(9), y - sz(4), sz(8), sz(5))
  ctx.fillRect(x + sz(1), y - sz(4), sz(8), sz(5))

  ctx.fillStyle = '#f5cba7'
  ctx.save(); ctx.translate(x - sz(3.5), y - sz(14)); ctx.rotate(leg * 0.06)
  ctx.fillRect(-sz(4), 0, sz(8), sz(12)); ctx.restore()
  ctx.save(); ctx.translate(x + sz(3.5), y - sz(14)); ctx.rotate(-leg * 0.06)
  ctx.fillRect(-sz(4), 0, sz(8), sz(12)); ctx.restore()

  ctx.fillStyle = '#fef08a'
  ctx.beginPath(); ctx.ellipse(x, y - sz(28), sz(11), sz(14), 0, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = '#f5cba7'
  const armA = onGnd ? Math.sin(frame * 0.22) * 6 : 0
  if (!onGnd) {
    ctx.save(); ctx.translate(x - sz(11), y - sz(29)); ctx.rotate(-0.7)
    ctx.fillRect(-sz(8), -sz(3), sz(8), sz(5)); ctx.restore()
    ctx.save(); ctx.translate(x + sz(11), y - sz(29)); ctx.rotate(0.7)
    ctx.fillRect(0, -sz(3), sz(8), sz(5)); ctx.restore()
  } else {
    ctx.save(); ctx.translate(x - sz(11), y - sz(27)); ctx.rotate(armA * 0.05)
    ctx.fillRect(-sz(8), -sz(3), sz(8), sz(5)); ctx.restore()
    ctx.save(); ctx.translate(x + sz(11), y - sz(27)); ctx.rotate(-armA * 0.05)
    ctx.fillRect(0, -sz(3), sz(8), sz(5)); ctx.restore()
  }

  ctx.fillStyle = '#f5cba7'
  ctx.beginPath(); ctx.arc(x, y - sz(51), sz(15), 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = '#7c5c3a'
  ctx.beginPath(); ctx.arc(x, y - sz(60), sz(9), Math.PI + 0.5, 2 * Math.PI - 0.5); ctx.fill()
  ctx.strokeStyle = '#7c5c3a'; ctx.lineWidth = sz(2)
  ctx.beginPath(); ctx.moveTo(x, y - sz(66)); ctx.quadraticCurveTo(x + sz(5), y - sz(70), x + sz(4), y - sz(68)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x, y - sz(66)); ctx.quadraticCurveTo(x - sz(5), y - sz(70), x - sz(4), y - sz(68)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x, y - sz(67)); ctx.quadraticCurveTo(x + sz(1), y - sz(72), x + sz(1), y - sz(70)); ctx.stroke()

  if (phase === 'gameover') {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5
    for (const ex of [x - sz(5), x + sz(5)]) {
      ctx.beginPath(); ctx.moveTo(ex - sz(3), y - sz(54)); ctx.lineTo(ex + sz(3), y - sz(48)); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(ex + sz(3), y - sz(54)); ctx.lineTo(ex - sz(3), y - sz(48)); ctx.stroke()
    }
  } else {
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(x - sz(5), y - sz(51), sz(4), 0, Math.PI * 2)
    ctx.arc(x + sz(5), y - sz(51), sz(4), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillRect(x - sz(7), y - sz(54), sz(2.5), sz(2.5))
    ctx.fillRect(x + sz(3.5), y - sz(54), sz(2.5), sz(2.5))
  }

  ctx.fillStyle = 'rgba(255,100,100,0.38)'
  ctx.beginPath(); ctx.arc(x - sz(10), y - sz(46), sz(6), 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(x + sz(10), y - sz(46), sz(6), 0, Math.PI * 2); ctx.fill()

  if (phase !== 'gameover') {
    ctx.fillStyle = '#c0392b'
    ctx.beginPath(); ctx.arc(x, y - sz(42), sz(3), 0, Math.PI); ctx.fill()
    ctx.fillStyle = 'rgba(125,211,252,0.75)'
    ctx.beginPath(); ctx.arc(x + sz(2), y - sz(38), sz(2.5), 0, Math.PI * 2); ctx.fill()
  } else {
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(x, y - sz(42), sz(3), Math.PI + 0.2, 2 * Math.PI - 0.2); ctx.stroke()
  }

  ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'
  const tw = ctx.measureText('Aner').width + 8
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - tw / 2, y - sz(83), tw, 13)
  ctx.fillStyle = '#86efac'; ctx.fillText('Aner', x, y - sz(73))
}

// ── Combined character poses (user-selectable) ────────────────────────────────
function drawChars(ctx, gs, phase, pose) {
  const { y, frame } = gs

  if (pose === 0) {
    drawReem(ctx, y, frame, phase)
    drawAner(ctx, y, frame, phase)

  } else if (pose === 1) {
    drawReem(ctx, y, frame, phase, true)
    ctx.save()
    ctx.translate(CHAR_X1 - 22, y - 38)
    ctx.rotate(-Math.PI / 2)
    ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'
    const rtw = ctx.measureText('Reem').width + 10
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(-rtw / 2, -14, rtw, 14)
    ctx.fillStyle = '#fbbf24'; ctx.fillText('Reem', 0, -4)
    ctx.restore()
    ctx.save()
    ctx.translate(CHAR_X1 - CHAR_X2, -46)
    drawAner(ctx, y, frame, phase)
    ctx.restore()

  } else {
    drawReem(ctx, y, frame, phase)
    ctx.save()
    const bx = CHAR_X2, by = y - 25
    const tx = CHAR_X1 + 5, ty = y - 35
    ctx.translate(tx, ty)
    ctx.rotate(Math.PI / 2)
    ctx.translate(-bx, -by)
    drawAner(ctx, y, frame, phase)
    ctx.restore()
  }
}

// ── Hornet squadron circle obstacle ──────────────────────────────────────────
const SRC_CX = 815, SRC_CY = 530, SRC_R = 313

function drawHornetObs(ctx, obs, img) {
  const r  = obs.h / 2
  const cx = obs.x
  const cy = GROUND - r

  ctx.save()
  ctx.translate(cx, GROUND + 1); ctx.scale(1, 0.2)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()

  if (img.complete && img.naturalWidth > 0) {
    const sR = SRC_R - 8
    ctx.translate(cx, cy)
    ctx.rotate(obs.rot)
    ctx.translate(-cx, -cy)
    ctx.drawImage(img,
      SRC_CX - sR, SRC_CY - sR, sR * 2, sR * 2,
      cx - r,      cy - r,      r * 2,  r * 2
    )
  } else {
    ctx.fillStyle = '#111'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#fbbf24'
    ctx.font = `bold ${Math.round(r)}px system-ui`
    ctx.textAlign = 'center'; ctx.fillText('⚡', cx, cy + r * 0.35)
  }
  ctx.restore()

  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = Math.max(2, r * 0.08)
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.stroke()

  ctx.strokeStyle = `rgba(251,191,36,${0.2 + 0.12 * Math.sin(obs.rot * 2)})`
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, obs.rot, obs.rot + Math.PI * 1.1); ctx.stroke()
}

function drawBackground(ctx, frame, speed) {
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, GROUND)
  ctx.fillStyle = 'rgba(148,163,184,0.5)'
  for (let i = 0; i < 22; i++) {
    ctx.fillRect(((i * 79 + frame * 0.15) % (W + 10)) - 5, 8 + (i * 53) % (GROUND - 24), 1.5, 1.5)
  }
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    const dx = W - ((i * 85 + frame * speed) % (W + 85))
    ctx.beginPath(); ctx.moveTo(dx, GROUND + 14); ctx.lineTo(dx + 48, GROUND + 14); ctx.stroke()
  }
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, GROUND, W, H - GROUND)
  ctx.fillStyle = '#334155'; ctx.fillRect(0, GROUND, W, 2)
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EasterEggGame({ onClose }) {
  const canvasRef = useRef(null)
  const [gameMode, setGameMode] = useState('select')   // 'select' | '1p' | '2p'
  const [activePose, setActivePose] = useState(0)
  const poseRef = useRef(0)

  function choosePose(p) { poseRef.current = p; setActivePose(p) }

  // ── 1P Game Loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (gameMode !== '1p') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let rafId

    const hornetImg = new Image()
    hornetImg.src = '/hornet.jpeg'

    const gs = {
      phase: 'idle',
      y: GROUND, vy: 0,
      obstacles: [],
      frame: 0, score: 0,
      speed: 4, nextObs: 110,
      hi: parseInt(localStorage.getItem('raner_hi') || '0'),
    }

    function jump() {
      if (gs.phase === 'idle')     { gs.phase = 'running'; return }
      if (gs.phase === 'gameover') { restart(); return }
      if (gs.phase === 'running' && gs.y >= GROUND - 2) gs.vy = JUMP_V
    }

    function restart() {
      gs.phase = 'running'
      gs.y = GROUND; gs.vy = 0
      gs.obstacles = []; gs.frame = 0; gs.score = 0
      gs.speed = 4; gs.nextObs = 110
    }

    function onKey(e) {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump() }
      if (e.code === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    canvas.addEventListener('click', jump)

    function loop() {
      ctx.clearRect(0, 0, W, H)
      drawBackground(ctx, gs.frame, gs.speed)

      if (gs.phase === 'idle') {
        drawChars(ctx, { ...gs, y: GROUND }, 'idle', poseRef.current)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(W / 2 - 165, GROUND / 2 - 30, 330, 56)
        ctx.fillStyle = '#7dd3fc'; ctx.font = 'bold 19px system-ui'; ctx.textAlign = 'center'
        ctx.fillText('REEM & ANER · JUMP!', W / 2, GROUND / 2 - 4)
        ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui'
        ctx.fillText('SPACE · CLICK · ↑  to start', W / 2, GROUND / 2 + 16)
        gs.frame++
        rafId = requestAnimationFrame(loop); return
      }

      if (gs.phase === 'running') {
        gs.frame++
        gs.speed = Math.min(11, 4 + gs.frame * 0.0012)
        gs.vy += GRAVITY
        gs.y = Math.min(GROUND, gs.y + gs.vy)
        if (gs.y >= GROUND) { gs.y = GROUND; gs.vy = 0 }

        gs.nextObs--
        if (gs.nextObs <= 0) {
          const r = 22 + Math.random() * 13
          gs.obstacles.push({ x: W + 20, h: r * 2, w: r * 2, rot: Math.random() * Math.PI * 2, scored: false })
          gs.nextObs = 68 + Math.random() * 68
        }

        for (const o of gs.obstacles) {
          o.x -= gs.speed
          o.rot += gs.speed / (o.h / 2)
          if (!o.scored && o.x + o.w / 2 < CHAR_X1 - 14) {
            o.scored = true; gs.score++
            if (gs.score > gs.hi) { gs.hi = gs.score; localStorage.setItem('raner_hi', String(gs.hi)) }
          }
        }
        gs.obstacles = gs.obstacles.filter(o => o.x > -60)

        const pose = poseRef.current
        const hitBoxes = pose === 1 ? [[CHAR_X1, 10]]
                       : pose === 2 ? [[CHAR_X1, 18]]
                       : [[CHAR_X1, 9], [CHAR_X2, 7]]
        let hit = false
        for (const o of gs.obstacles) {
          if (o.scored) continue
          const oL = o.x - o.w / 2, oR = o.x + o.w / 2, oTop = GROUND - o.h
          for (const [hx, cw] of hitBoxes) {
            if (oR > hx - cw && oL < hx + cw && gs.y > oTop + 4) { hit = true; break }
          }
          if (hit) break
        }
        if (hit) gs.phase = 'gameover'

        for (const o of gs.obstacles) drawHornetObs(ctx, o, hornetImg)
        drawChars(ctx, gs, 'running', poseRef.current)

        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - 148, 8, 140, 20)
        ctx.fillStyle = '#7dd3fc'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right'
        ctx.fillText(`JUMPS: ${gs.score}   HI: ${gs.hi}`, W - 10, 22)
        rafId = requestAnimationFrame(loop); return
      }

      // game over
      for (const o of gs.obstacles) drawHornetObs(ctx, o, hornetImg)
      drawChars(ctx, gs, 'gameover', poseRef.current)
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('GAME OVER', W / 2, H / 2 - 22)
      ctx.fillStyle = '#f1f5f9'; ctx.font = '13px system-ui'
      ctx.fillText(`Score: ${gs.score} jumps   •   Best: ${gs.hi}`, W / 2, H / 2 + 5)
      ctx.fillStyle = '#475569'; ctx.font = '11px system-ui'
      ctx.fillText('SPACE · CLICK to play again', W / 2, H / 2 + 26)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - 148, 8, 140, 20)
      ctx.fillStyle = '#7dd3fc'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right'
      ctx.fillText(`JUMPS: ${gs.score}   HI: ${gs.hi}`, W - 10, 22)
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('click', jump)
    }
  }, [gameMode, onClose])

  // ── 2P Game Loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (gameMode !== '2p') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let rafId

    const hornetImg = new Image()
    hornetImg.src = '/hornet.jpeg'

    const TOTAL_H = H * 2 + STRIP_SEP

    const gs = {
      phase: 'idle',  // 'idle' | 'running' | 'roundover' | 'matchover'
      obstacles: [], frame: 0, speed: 4, nextObs: 110,
      reem: { y: GROUND, vy: 0, alive: true, wins: 0 },
      aner: { y: GROUND, vy: 0, alive: true, wins: 0 },
      roundMsg: '', celebFrame: 0, confetti: [],
    }

    function jumpReem() {
      if (gs.phase === 'idle')  { startRound(); return }
      if (gs.phase === 'roundover' || gs.phase === 'matchover') { handleNext(); return }
      if (gs.reem.alive && gs.reem.y >= GROUND - 2) gs.reem.vy = JUMP_V
    }
    function jumpAner() {
      if (gs.phase === 'idle')  { startRound(); return }
      if (gs.phase === 'roundover' || gs.phase === 'matchover') { handleNext(); return }
      if (gs.aner.alive && gs.aner.y >= GROUND - 2) gs.aner.vy = JUMP_V
    }

    function startRound() {
      gs.phase = 'running'
      gs.obstacles = []; gs.frame = 0; gs.speed = 4; gs.nextObs = 110
      gs.reem.y = GROUND; gs.reem.vy = 0; gs.reem.alive = true
      gs.aner.y = GROUND; gs.aner.vy = 0; gs.aner.alive = true
    }

    function handleNext() {
      if (gs.phase === 'matchover') {
        // full reset
        gs.reem.wins = 0; gs.aner.wins = 0
        gs.phase = 'idle'
      } else {
        startRound()
      }
    }

    function onKey(e) {
      if (e.code === 'ArrowUp') { e.preventDefault(); jumpReem() }
      if (e.code === 'KeyQ')    { e.preventDefault(); jumpAner() }
      if (e.code === 'Space') {
        e.preventDefault()
        // Space only starts/restarts — each player jumps with their own key
        if (gs.phase === 'idle') { startRound(); return }
        if (gs.phase === 'roundover' || gs.phase === 'matchover') handleNext()
      }
      if (e.code === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    const clickH = () => {
      if (gs.phase === 'idle') { startRound(); return }
      if (gs.phase === 'roundover' || gs.phase === 'matchover') handleNext()
    }
    canvas.addEventListener('click', clickH)

    // Draw one strip — player is 'reem' (top) or 'aner' (bottom)
    function drawStrip(player) {
      const p     = player === 'reem' ? gs.reem : gs.aner
      const phase = p.alive ? 'running' : 'gameover'

      drawBackground(ctx, gs.frame, gs.speed)
      for (const o of gs.obstacles) drawHornetObs(ctx, o, hornetImg)

      if (player === 'reem') {
        drawReem(ctx, p.y, gs.frame, phase, false)
      } else {
        // Shift Aner to CHAR_X1 so both characters are at the same x in their strip
        ctx.save()
        ctx.translate(CHAR_X1 - CHAR_X2, 0)
        drawAner(ctx, p.y, gs.frame, phase)
        ctx.restore()
      }

      // Top-left player badge
      ctx.font = 'bold 10px system-ui'
      const badgeLabel = player === 'reem' ? 'REEM  [ ↑ ]' : 'ANER  [ Q ]'
      const badgeColor = player === 'reem' ? '#fbbf24' : '#86efac'
      const bw = ctx.measureText(badgeLabel).width + 12
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(4, 4, bw, 16)
      ctx.fillStyle = badgeColor; ctx.textAlign = 'left'
      ctx.fillText(badgeLabel, 10, 16)

      // Top-right wins (stars)
      const wins = p.wins
      ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'right'
      ctx.fillStyle = '#7dd3fc'
      ctx.fillText('★'.repeat(wins) + '☆'.repeat(3 - wins), W - 6, 17)
    }

    function loop() {
      ctx.clearRect(0, 0, W, TOTAL_H)

      // ── strip 1: Reem (top) ──
      ctx.save()
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()
      drawStrip('reem')
      ctx.restore()

      // ── divider ──
      ctx.fillStyle = '#1e3a5f'
      ctx.fillRect(0, H, W, STRIP_SEP)
      // score in divider
      ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'
      ctx.fillStyle = '#475569'
      ctx.fillText(`REEM ${gs.reem.wins} – ANER ${gs.aner.wins}  ·  BEST OF 3`, W / 2, H + STRIP_SEP - 1)

      // ── strip 2: Aner (bottom) ──
      ctx.save()
      ctx.translate(0, H + STRIP_SEP)
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()
      drawStrip('aner')
      ctx.restore()

      // ── idle overlay ──
      if (gs.phase === 'idle') {
        gs.frame++
        ctx.fillStyle = 'rgba(0,0,0,0.60)'
        ctx.fillRect(W / 2 - 190, TOTAL_H / 2 - 36, 380, 66)
        ctx.fillStyle = '#7dd3fc'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'
        ctx.fillText('REEM  vs  ANER  —  BEST OF 3', W / 2, TOTAL_H / 2 - 14)
        ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui'
        ctx.fillText('↑ = REEM jump      Q = ANER jump      SPACE = both start', W / 2, TOTAL_H / 2 + 10)
        rafId = requestAnimationFrame(loop); return
      }

      // ── running: physics + obstacles ──
      if (gs.phase === 'running') {
        gs.frame++
        gs.speed = Math.min(11, 4 + gs.frame * 0.0012)

        for (const p of [gs.reem, gs.aner]) {
          if (!p.alive) continue
          p.vy += GRAVITY
          p.y = Math.min(GROUND, p.y + p.vy)
          if (p.y >= GROUND) { p.y = GROUND; p.vy = 0 }
        }

        gs.nextObs--
        if (gs.nextObs <= 0) {
          const r = 22 + Math.random() * 13
          gs.obstacles.push({ x: W + 20, h: r * 2, w: r * 2, rot: Math.random() * Math.PI * 2, scored: false })
          gs.nextObs = 68 + Math.random() * 68
        }
        for (const o of gs.obstacles) {
          o.x -= gs.speed
          o.rot += gs.speed / (o.h / 2)
          if (!o.scored && o.x + o.w / 2 < CHAR_X1 - 14) o.scored = true
        }
        gs.obstacles = gs.obstacles.filter(o => o.x > -60)

        // Collision — both use CHAR_X1 as their screen x (Aner is translated in draw)
        for (const o of gs.obstacles) {
          if (o.scored) continue
          const oL = o.x - o.w / 2, oR = o.x + o.w / 2, oTop = GROUND - o.h
          if (oR > CHAR_X1 - 9 && oL < CHAR_X1 + 9) {
            if (gs.reem.alive && gs.reem.y > oTop + 4) gs.reem.alive = false
            if (gs.aner.alive && gs.aner.y > oTop + 4) gs.aner.alive = false
          }
        }

        if (!gs.reem.alive || !gs.aner.alive) {
          const reemDead = !gs.reem.alive, anerDead = !gs.aner.alive
          if (reemDead && anerDead) {
            gs.roundMsg = 'DRAW — no point awarded'
          } else if (reemDead) {
            gs.aner.wins++
            gs.roundMsg = 'ANER WINS THE ROUND!'
          } else {
            gs.reem.wins++
            gs.roundMsg = 'REEM WINS THE ROUND!'
          }
          gs.phase = (gs.reem.wins >= 3 || gs.aner.wins >= 3) ? 'matchover' : 'roundover'
          if (gs.phase === 'matchover') {
            gs.celebFrame = 0
            gs.confetti = Array.from({length: 60}, () => ({
              x: Math.random() * W,
              y: Math.random() * TOTAL_H * 0.4,
              vx: (Math.random() - 0.5) * 3,
              vy: Math.random() * -5 - 1,
              color: ['#fbbf24','#f87171','#86efac','#7dd3fc','#c4b5fd'][Math.floor(Math.random() * 5)],
              rot: Math.random() * Math.PI * 2,
              rotV: (Math.random() - 0.5) * 0.25,
              w: Math.random() * 8 + 4,
              h: Math.random() * 4 + 3,
            }))
          }
        }
      }

      // ── round over overlay ──
      if (gs.phase === 'roundover') {
        ctx.fillStyle = 'rgba(0,0,0,0.70)'
        ctx.fillRect(0, 0, W, TOTAL_H)
        const isReemWin = gs.roundMsg.startsWith('REEM')
        const isDraw    = gs.roundMsg.startsWith('DRAW')
        ctx.fillStyle = isDraw ? '#94a3b8' : isReemWin ? '#fbbf24' : '#86efac'
        ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'
        ctx.fillText(gs.roundMsg, W / 2, TOTAL_H / 2 - 22)
        ctx.fillStyle = '#f1f5f9'; ctx.font = '13px system-ui'
        ctx.fillText(
          `Reem ${'★'.repeat(gs.reem.wins)}${'☆'.repeat(3 - gs.reem.wins)}  vs  Aner ${'★'.repeat(gs.aner.wins)}${'☆'.repeat(3 - gs.aner.wins)}`,
          W / 2, TOTAL_H / 2 + 2
        )
        ctx.fillStyle = '#475569'; ctx.font = '11px system-ui'
        ctx.fillText('SPACE · CLICK · ↑ · Q  to continue', W / 2, TOTAL_H / 2 + 24)
      }

      // ── match over overlay (confetti + bouncing winner) ──
      if (gs.phase === 'matchover') {
        gs.celebFrame++
        // update + recycle confetti
        for (const c of gs.confetti) {
          c.x += c.vx; c.y += c.vy
          c.vy += 0.15; c.rot += c.rotV
          if (c.y > TOTAL_H + 20) { c.y = -10; c.x = Math.random() * W; c.vy = Math.random() * -5 - 1 }
        }
        // dark overlay
        ctx.fillStyle = 'rgba(0,0,0,0.62)'
        ctx.fillRect(0, 0, W, TOTAL_H)
        // confetti
        for (const c of gs.confetti) {
          ctx.save()
          ctx.translate(c.x, c.y); ctx.rotate(c.rot)
          ctx.fillStyle = c.color
          ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h)
          ctx.restore()
        }
        // bouncing winner character at bottom
        const reemWon = gs.reem.wins >= 3
        const bounce = -Math.abs(Math.sin(gs.celebFrame * 0.12)) * 22
        ctx.save()
        if (reemWon) {
          ctx.translate(W / 2 - CHAR_X1, bounce)
          drawReem(ctx, TOTAL_H - 46, gs.celebFrame, 'running')
        } else {
          ctx.translate(W / 2 - CHAR_X2, bounce)
          drawAner(ctx, TOTAL_H - 46, gs.celebFrame, 'running')
        }
        ctx.restore()
        // text
        ctx.fillStyle = reemWon ? '#fbbf24' : '#86efac'
        ctx.font = 'bold 30px system-ui'; ctx.textAlign = 'center'
        ctx.fillText(reemWon ? 'REEM WINS THE MATCH!' : 'ANER WINS THE MATCH!', W / 2, TOTAL_H / 2 - 26)
        ctx.fillStyle = '#f1f5f9'; ctx.font = '14px system-ui'
        ctx.fillText(`Reem ${'★'.repeat(gs.reem.wins)}${'☆'.repeat(3 - gs.reem.wins)}  vs  Aner ${'★'.repeat(gs.aner.wins)}${'☆'.repeat(3 - gs.aner.wins)}`, W / 2, TOTAL_H / 2 + 2)
        ctx.fillStyle = '#475569'; ctx.font = '11px system-ui'
        ctx.fillText('SPACE · CLICK · ↑ · Q  to play again', W / 2, TOTAL_H / 2 + 26)
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('click', clickH)
    }
  }, [gameMode, onClose])

  // ── Render ────────────────────────────────────────────────────────────────
  const canvasH = gameMode === '2p' ? H * 2 + STRIP_SEP : H

  const btnBase = {
    border: '1px solid #334155', borderRadius: 6,
    cursor: 'pointer', fontFamily: 'system-ui', padding: '12px 28px',
    fontSize: 14, fontWeight: 700, letterSpacing: 1,
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#0f172a', border: '2px solid #1e3a5f', borderRadius: 14,
        padding: '16px 20px 12px',
        boxShadow: '0 12px 60px rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        userSelect: 'none',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {gameMode !== 'select' && (
              <button
                onClick={() => setGameMode('select')}
                style={{ ...btnBase, padding: '2px 8px', fontSize: 10, color: '#475569', background: 'none' }}
              >← BACK</button>
            )}
            <span style={{ color: '#7dd3fc', fontWeight: 900, fontSize: 13, letterSpacing: 2, fontFamily: 'system-ui' }}>
              🎮  REEM &amp; ANER  ·  JUMP TOGETHER!
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid #334155', borderRadius: 4,
            color: '#475569', cursor: 'pointer', fontSize: 11,
            padding: '2px 8px', fontFamily: 'system-ui', marginLeft: 16,
          }}>✕ ESC</button>
        </div>

        {/* Mode select screen */}
        {gameMode === 'select' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 24, padding: '24px 40px 16px',
          }}>
            <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'system-ui', letterSpacing: 2 }}>
              SELECT GAME MODE
            </span>
            <div style={{ display: 'flex', gap: 20 }}>
              <button
                onClick={() => setGameMode('1p')}
                style={{ ...btnBase, color: '#7dd3fc', background: '#0f2744', borderColor: '#1e4a7a' }}
              >
                <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 6 }}>👤</div>
                <div>1 PLAYER</div>
                <div style={{ fontSize: 9, color: '#475569', fontWeight: 400, marginTop: 4 }}>SPACE / ↑ to jump</div>
              </button>
              <button
                onClick={() => setGameMode('2p')}
                style={{ ...btnBase, color: '#86efac', background: '#0a2518', borderColor: '#166534' }}
              >
                <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 6 }}>👥</div>
                <div>2 PLAYERS</div>
                <div style={{ fontSize: 9, color: '#475569', fontWeight: 400, marginTop: 4 }}>↑ = Reem  /  Q = Aner</div>
              </button>
            </div>
            <span style={{ color: '#1e3a5f', fontSize: 9, fontFamily: 'system-ui', letterSpacing: 1 }}>
              2P: BEST OF 3 ROUNDS — FIRST TO FAIL LOSES THE ROUND
            </span>
          </div>
        )}

        {/* Game canvas */}
        {gameMode !== 'select' && (
          <>
            <canvas
              ref={canvasRef} width={W} height={canvasH}
              style={{ display: 'block', borderRadius: 8, cursor: 'pointer', border: '1px solid #1e293b' }}
            />
            {gameMode === '1p' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', justifyContent: 'space-between' }}>
                <div style={{ color: '#334155', fontSize: 9, fontFamily: 'system-ui', letterSpacing: 1.5 }}>
                  SPACE · CLICK · ↑ ARROW TO JUMP
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#475569', fontSize: 9, fontFamily: 'system-ui', letterSpacing: 1 }}>POSE:</span>
                  {[
                    { label: 'Side by side', p: 0 },
                    { label: 'On shoulders', p: 1 },
                    { label: 'Cradling',     p: 2 },
                  ].map(({ label, p }) => (
                    <button
                      key={p}
                      onClick={() => choosePose(p)}
                      style={{
                        background: activePose === p ? '#1e3a5f' : 'none',
                        border: `1px solid ${activePose === p ? '#3b82f6' : '#334155'}`,
                        borderRadius: 4,
                        color: activePose === p ? '#7dd3fc' : '#475569',
                        cursor: 'pointer', fontSize: 9,
                        padding: '2px 7px', fontFamily: 'system-ui', letterSpacing: 0.5,
                      }}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}
            {gameMode === '2p' && (
              <div style={{ color: '#334155', fontSize: 9, fontFamily: 'system-ui', letterSpacing: 1.5 }}>
                ↑ = REEM JUMP &nbsp;·&nbsp; Q = ANER JUMP &nbsp;·&nbsp; BEST OF 3 ROUNDS
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
