import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Dashboard } from '@shared/types'
import { fmt } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

/** 53 weeks — the landscape always shows a trailing year, whatever range is picked. */
const DAYS_IN_VIEW = 371
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/* --- geometry constants, matching the reference render's proportions --------
   Cell pitch 13 with a 1.8 gap, tallest column 38 — i.e. under 3 cells high.
   Keeping columns short is what makes the terrain read as stepped plateaus
   instead of a bed of spikes. */
const UNIT = 13
const GAP = 1.8
const BAR = UNIT - GAP
const HEIGHT_MAX = 38
/** Level 0 keeps a sliver of thickness so inactive days still form the floor. */
const LEVEL_H = [1.8, 9.5, 19, 28.5, 38]

/** GitHub-style 5-step ramps; index is the day's level. */
const PALETTE = {
  dark: ['#2d333b', '#065f46', '#059669', '#10b981', '#34d399'],
  light: ['#ebedf0', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981']
}

/* Flat per-face shading, baked as vertex colours — no lights, no specular.
   BoxGeometry face order is +x, -x, +y, -y, +z, -z. The three faces visible at
   the default camera angle are +y (top), -x and +z; their factors are what the
   reference computes for that orientation. */
const FACE_SHADE = [0.62, 0.451, 1.0, 0.33, 0.614, 0.7]

interface Cell {
  wi: number
  di: number
  day: string
  value: number
  level: number
}

function toDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** 0 = Monday … 6 = Sunday, matching the 2D heatmap's row order. */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

const DAY_MS = 86400000

/** Linear-interpolated quantile over a pre-sorted ascending array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)
}

/**
 * Token Landscape — a trailing year of daily token spend as an isometric terrain,
 * modelled on xiufengsun/TokenTracker's annual heatmap.
 *
 * Two decisions carried over from that reference:
 *  - Height and colour are driven by a 0–4 quantile *level*, not the raw token
 *    count, so the terrain quantises to five clean plateaus instead of a few
 *    spikes drowning everything else.
 *  - Columns are short (< 3 cells tall) and the camera is a low isometric, so
 *    it reads as a calendar ribbon rather than a bar forest.
 *
 * Reads `data.heatmap` (the aggregator's trailing 371-day window), so it is a
 * fixed "last year" view and ignores the range selector at the top of the app.
 *
 * three.js rather than echarts-gl: echarts-gl's ViewGL builds an
 * EffectCompositor via `new Function()`, which the app's `script-src 'self'`
 * CSP forbids. three.js compiles shaders through WebGL, so the CSP stays strict.
 */
export function ThreeDLab({ data, themeKey }: Props) {
  const isDark = themeKey !== 'light'

  const {
    cells,
    weeks,
    span,
    activeDays,
    peak,
    windowDays,
    longestStreak,
    totalTokens,
    thresholds
  } = useMemo(() => {
    const empty = {
      cells: [] as Cell[],
      weeks: 0,
      span: '',
      activeDays: 0,
      peak: null as { day: string; value: number } | null,
      windowDays: 0,
      longestStreak: 0,
      totalTokens: 0,
      thresholds: [0, 0, 0] as [number, number, number]
    }


    const year = data.heatmap.slice(-DAYS_IN_VIEW)
    if (year.length === 0) return empty

    // Quantile thresholds over active days only, as the reference does.
    const active = year.filter((h) => h.total > 0).map((h) => h.total)
    if (active.length === 0) return empty
    active.sort((a, b) => a - b)
    const t1 = quantile(active, 0.5)
    const t2 = quantile(active, 0.75)
    const t3 = quantile(active, 0.9)
    const levelFor = (v: number) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4)

    const first = toDate(year[0]!.day)
    const anchor = new Date(first.getTime() - mondayIndex(first) * DAY_MS)
    const weekOf = (day: string) =>
      Math.floor((toDate(day).getTime() - anchor.getTime()) / (7 * DAY_MS))

    let mx = 0
    let peakDay = year[0]!.day
    let total = 0
    let days = 0
    // Longest run of consecutive active days. `year` has one entry per calendar
    // day, so adjacent indices are adjacent dates — no date arithmetic needed.
    let streak = 0
    let bestStreak = 0
    let maxWi = 0
    // Every day in the window gets a cell, including the empty ones: they are
    // drawn as thin level-0 slabs, which is what forms the continuous
    // year-long base plate the bars rise out of. Dropping them left the
    // terrain as disconnected islands floating in space.
    const out: Cell[] = []
    for (const h of year) {
      total += h.total
      if (h.total > 0) {
        days += 1
        streak += 1
        if (streak > bestStreak) bestStreak = streak
        if (h.total > mx) {
          mx = h.total
          peakDay = h.day
        }
      } else {
        streak = 0
      }
      const wi = weekOf(h.day)
      if (wi > maxWi) maxWi = wi
      out.push({
        wi,
        di: mondayIndex(toDate(h.day)),
        day: h.day,
        value: h.total,
        level: levelFor(h.total)
      })
    }

    return {
      cells: out,
      // `anchor` is the Monday of the window's first week, so week indices
      // already start at 0 — no normalisation, and no cropping either.
      weeks: maxWi + 1,
      span: `${year[0]!.day} → ${year[year.length - 1]!.day}`,
      activeDays: days,
      peak: { day: peakDay, value: mx },
      windowDays: year.length,
      longestStreak: bestStreak,
      totalTokens: total,
      thresholds: [t1, t2, t3] as [number, number, number]
    }
  }, [data.heatmap])

  /* The panel is the fullscreen target: a 53:7 plate is starved for width in
     the normal layout, so going fullscreen buys far more here than it would on
     an ordinary chart. `:fullscreen` in CSS handles the resizing; this state
     only drives the button label. */
  const panelRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void panelRef.current?.requestFullscreen()
  }

  /* Imperative handle out of the scene: OrbitControls lets you tumble the view
     with no way back, so the reset has to reach the camera it created. */
  const api = useRef<{ reset: () => void } | null>(null)

  return (
    <div className="fade-in lab3d">
      <div className="panel lab3d-panel" ref={panelRef}>
        <div className="panel-head">
          <h3>Token Landscape</h3>
          <span className="note">最近一年 · {span}</span>
        </div>
        {cells.length > 0 ? (
          <div className="lab3d-body">
            <aside className="lab3d-stats">
              <Stat k="ANNUAL TOTAL TOKENS" v={fmt(totalTokens)} />
              <Stat k="PEAK DAY" v={fmt(peak!.value)} sub={peak!.day} accent />
              <Stat
                k="ACTIVE RATE"
                v={`${((activeDays / windowDays) * 100).toFixed(1)}%`}
                sub={`${activeDays} / ${windowDays} 天`}
              />
              <Stat k="LONGEST STREAK" v={`${longestStreak} 天`} />
            </aside>
            <div className="lab3d-view">
              <Landscape
                cells={cells}
                weeks={weeks}
                isDark={isDark}
                themeKey={themeKey}
                api={api}
              />
              <div className="lab3d-legend">
                <Ramp isDark={isDark} thresholds={thresholds} />
                <div className="lab3d-tools">
                  <button type="button" onClick={() => api.current?.reset()}>
                    复位视角
                  </button>
                  <button type="button" onClick={toggleFull}>
                    {full ? '退出全屏' : '全屏'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="center-state" style={{ minHeight: 320 }}>
            <p>最近一年没有可用数据。</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The five-step ramp with the actual quantile cut-offs spelled out. Without the
 * numbers the colours carry no information — you can see one day is darker than
 * another but not by how much.
 */
function Ramp({ isDark, thresholds }: { isDark: boolean; thresholds: [number, number, number] }) {
  const palette = isDark ? PALETTE.dark : PALETTE.light
  const [t1, t2, t3] = thresholds
  const labels = ['无记录', `≤${fmt(t1)}`, `≤${fmt(t2)}`, `≤${fmt(t3)}`, `>${fmt(t3)}`]
  return (
    <div className="ramp">
      <span className="ramp-k">每日用量</span>
      {palette.map((c, i) => (
        <span className="ramp-step" key={c}>
          <i style={{ background: c }} />
          {labels[i]}
        </span>
      ))}
    </div>
  )
}

function Stat({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className="lab3d-stat">
      <div className="lab3d-stat-k">{k}</div>
      <div className={'lab3d-stat-v' + (accent ? ' accent' : '')}>{v}</div>
      {sub && <div className="lab3d-stat-sub">{sub}</div>}
    </div>
  )
}

/**
 * Sizes an orthographic frustum so the terrain exactly fills the viewport.
 * An orthographic camera can't be moved back to fit — the frustum *is* the fit.
 * It is deliberately off-centre: the terrain's midpoint in camera space is not
 * the camera axis, and a symmetric box around the axis wastes half the viewport.
 */
function fitOrtho(
  camera: THREE.OrthographicCamera,
  aspect: number,
  corners: THREE.Vector3[],
  pad = 1.03
): void {
  camera.updateMatrixWorld()
  const inv = camera.matrixWorld.clone().invert()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const v = new THREE.Vector3()
  for (const c of corners) {
    v.copy(c).applyMatrix4(inv)
    minX = Math.min(minX, v.x)
    maxX = Math.max(maxX, v.x)
    minY = Math.min(minY, v.y)
    maxY = Math.max(maxY, v.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let halfW = ((maxX - minX) / 2) * pad
  let halfH = ((maxY - minY) / 2) * pad
  if (halfW / halfH < aspect) halfW = halfH * aspect
  else halfH = halfW / aspect
  camera.left = cx - halfW
  camera.right = cx + halfW
  camera.top = cy + halfH
  camera.bottom = cy - halfH
  camera.updateProjectionMatrix()
}

interface Tip {

  x: number
  y: number
  /** Anchor to the cursor's left/above instead, when the box would overflow. */
  flipX: boolean
  flipY: boolean
  day: string
  weekday: string
  value: number
}

interface SceneProps {
  cells: Cell[]
  weeks: number
  isDark: boolean
  themeKey: string
  api: React.MutableRefObject<{ reset: () => void } | null>
}

/**
 * Per-face shade factors as a 24-vertex colour buffer (grey).
 * three.js multiplies vertex colour by `instanceColor`, so the geometry carries
 * the flat shading and each instance only carries its level's hue.
 */
function faceShadeAttribute(): THREE.BufferAttribute {
  const arr = new Float32Array(24 * 3)
  for (let f = 0; f < 6; f++) {
    const s = FACE_SHADE[f]!
    for (let v = 0; v < 4; v++) {
      const o = (f * 4 + v) * 3
      arr[o] = s
      arr[o + 1] = s
      arr[o + 2] = s
    }
  }
  return new THREE.BufferAttribute(arr, 3)
}


/* Entrance animation. Bars are staggered along the week axis so the year fills
   in chronologically rather than every column popping at once — on a 53-week
   plate a simultaneous rise reads as a glitch, a sweep reads as a timeline. */
/** ms for one bar to reach full height. */
const RISE_MS = 420
/** ms for the leading edge to cross the whole plate. */
const SWEEP_MS = 900
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

function Landscape({ cells, weeks, isDark, themeKey, api }: SceneProps) {
  const mount = useRef<HTMLDivElement>(null)
  const axisRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    const el = mount.current
    if (!el) return

    const palette = isDark ? PALETTE.dark : PALETTE.light
    const spanX = weeks * UNIT
    const depth = 7 * UNIT
    const xOf = (wi: number) => (wi - (weeks - 1) / 2) * UNIT

    const scene = new THREE.Scene()
    let vw = el.clientWidth || 800
    let vh = el.clientHeight || 480

    // Orthographic isometric: parallel edges, no perspective foreshortening.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 8000)
    // Low tilt + slight yaw = the reference's long, gently angled ribbon.
    const home = new THREE.Vector3(0.55, 0.62, 1).normalize().multiplyScalar(1000)
    camera.position.copy(home)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(vw, vh)
    el.appendChild(renderer.domElement)

    // One box per day, flat-shaded via vertex colours; MeshBasicMaterial means
    // no lights and no specular, which is what keeps the reference look clean.
    const geom = new THREE.BoxGeometry(BAR, 1, BAR)
    geom.translate(0, 0.5, 0) // pivot at the base so scale.y grows upward
    geom.setAttribute('color', faceShadeAttribute())
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true })
    const mesh = new THREE.InstancedMesh(geom, mat, cells.length)

    const m4 = new THREE.Matrix4()
    const color = new THREE.Color()
    cells.forEach((c, i) => mesh.setColorAt(i, color.set(palette[c.level]!)))
    scene.add(mesh)

    /* Growth: per-cell delay from its week, so the rise sweeps left to right.
       A tiny floor on the scale avoids a degenerate zero-determinant matrix. */
    const delays = cells.map((c) => (weeks > 1 ? (c.wi / (weeks - 1)) * SWEEP_MS : 0))
    const growthAt = (elapsed: number, i: number) => {
      const raw = (elapsed - delays[i]!) / RISE_MS
      return raw <= 0 ? 0 : raw >= 1 ? 1 : easeOutCubic(raw)
    }
    const writeBars = (elapsed: number) => {
      let done = true
      cells.forEach((c, i) => {
        const p = growthAt(elapsed, i)
        if (p < 1) done = false
        m4.makeScale(1, Math.max(LEVEL_H[c.level]! * p, 0.0001), 1)
        m4.setPosition(xOf(c.wi), 0, (c.di - 3) * UNIT)
        mesh.setMatrixAt(i, m4)
      })
      mesh.instanceMatrix.needsUpdate = true
      return done
    }

    /* Today gets a wireframe cage. On a 371-cell plate the newest day is
       otherwise indistinguishable, and it is the one cell you always want to
       find first. */
    const last = cells[cells.length - 1]
    let cage: THREE.LineSegments | null = null
    let cageH = 0
    if (last) {
      cageH = LEVEL_H[last.level]!
      const box = new THREE.BoxGeometry(BAR + 1.4, cageH + 1, BAR + 1.4)
      const edges = new THREE.EdgesGeometry(box)
      box.dispose()
      cage = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: isDark ? 0xf1f5f9 : 0x0f172a })
      )
      cage.position.set(xOf(last.wi), cageH / 2, (last.di - 3) * UNIT)
      scene.add(cage)
    }
    // The cage has to rise with its bar, or it hangs in mid-air during the sweep.
    const syncCage = (p: number) => {
      if (!cage) return
      cage.scale.y = Math.max(p, 0.0001)
      cage.position.y = (cageH * p) / 2
    }

    /* Honour the OS reduced-motion setting by jumping straight to the end state.
       The entrance runs on every scene build. It deliberately does *not* use a
       "played once" ref: StrictMode double-invokes effects in dev, so the first
       pass would burn the flag and the visible second pass would never animate —
       the effect was missing under `npm run dev` while working in a production
       build, which is exactly the trap that hid it. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animating = !reduced
    if (animating) {
      writeBars(0)
      syncCage(0)
    } else {
      writeBars(Infinity)
      syncCage(1)
    }

    /* Month ticks along the front edge, as plain DOM projected each frame.
       HTML labels stay crisp at any zoom and cost no texture memory, unlike
       sprites — and there are only ~12 of them to reposition. */
    const marks: { node: HTMLDivElement; pos: THREE.Vector3 }[] = []
    const axis = axisRef.current
    if (axis) {
      axis.replaceChildren()
      for (const c of cells) {
        if (!c.day.endsWith('-01')) continue
        const node = document.createElement('div')
        node.className = 'lab3d-mark'
        const mm = Number(c.day.slice(5, 7))
        // January carries the year instead, so the window is self-dating.
        node.textContent = mm === 1 ? c.day.slice(0, 4) : `${mm}月`
        axis.appendChild(node)
        marks.push({ node, pos: new THREE.Vector3(xOf(c.wi), 0, 4.2 * UNIT) })
      }
    }
    const mp = new THREE.Vector3()
    const placeMarks = () => {
      for (const mk of marks) {
        mp.copy(mk.pos).project(camera)
        const x = (mp.x * 0.5 + 0.5) * vw
        const y = (-mp.y * 0.5 + 0.5) * vh
        mk.node.style.transform = `translate(${x}px, ${y}px) translate(-50%, 2px)`
      }
    }

    // --- frustum fit --------------------------------------------------------
    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, HEIGHT_MAX]) {
          corners.push(new THREE.Vector3((sx * (spanX + UNIT)) / 2, y, (sz * (depth + UNIT)) / 2))
        }
      }
    }
    fitOrtho(camera, vw / vh, corners)

    // --- hover tooltip via raycasting --------------------------------------
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let lastHover = -1
    // Rough tooltip box, used only to decide which side of the cursor to anchor.
    const TIP_W = 150
    const TIP_H = 52
    const onPointerMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const id = raycaster.intersectObject(mesh)[0]?.instanceId ?? -1
      const lx = e.clientX - r.left
      const ly = e.clientY - r.top
      // Flip to the other side of the cursor when the box would leave the canvas.
      const flipX = lx + 14 + TIP_W > r.width
      const flipY = ly + 12 + TIP_H > r.height
      const px = flipX ? lx - 14 : lx + 14
      const py = flipY ? ly - 12 : ly + 12
      if (id === lastHover) {
        if (id >= 0) setTip((t) => (t ? { ...t, x: px, y: py, flipX, flipY } : t))
        return
      }
      lastHover = id
      if (id < 0) {
        setTip(null)
        return
      }
      const c = cells[id]!
      setTip({ x: px, y: py, flipX, flipY, day: c.day, weekday: WEEKDAYS[c.di]!, value: c.value })
    }
    const onLeave = () => {
      lastHover = -1
      setTip(null)
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // Stay above the ground plane so the terrain is never viewed from below.
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minZoom = 0.5
    controls.maxZoom = 8
    controls.enablePan = false

    // Expose a reset so the toolbar button can undo any tumbling/zoom.
    api.current = {
      reset: () => {
        camera.position.copy(home)
        camera.zoom = 1
        camera.up.set(0, 1, 0)
        controls.target.set(0, 0, 0)
        camera.lookAt(0, 0, 0)
        fitOrtho(camera, vw / vh, corners)
        controls.update()
      }
    }

    let raf = 0
    let startTs = 0
    const tick = (now: number) => {
      if (animating) {
        if (startTs === 0) startTs = now
        const elapsed = now - startTs
        syncCage(growthAt(elapsed, cells.length - 1))
        if (writeBars(elapsed)) animating = false
      }
      controls.update()
      renderer.render(scene, camera)
      placeMarks()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      vw = w
      vh = h
      renderer.setSize(w, h)
      fitOrtho(camera, w / h, corners)
    })
    ro.observe(el)


    return () => {
      api.current = null
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (axis) axis.replaceChildren()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose()
          const m = o.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, weeks, themeKey])

  return (
    <div className="chart-3d" ref={mount}>
      <div className="lab3d-axis" ref={axisRef} />
      {tip && (
        <div
          className="lab3d-tip"
          style={{
            left: tip.x,
            top: tip.y,
            // translate by the box's own size, so no measuring is needed.
            transform: `translate(${tip.flipX ? '-100%' : '0'}, ${tip.flipY ? '-100%' : '0'})`
          }}
        >
          <b>{tip.day}</b> <span className="dim">{tip.weekday}</span>
          <br />
          {tip.value > 0 ? `${fmt(tip.value)} tokens` : '无记录'}
        </div>
      )}
    </div>
  )
}


