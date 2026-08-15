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

  const { cells, weeks, span, activeDays, peak, windowDays, longestStreak, totalTokens } = useMemo(() => {
    const empty = {
      cells: [] as Cell[],
      weeks: 0,
      span: '',
      activeDays: 0,
      peak: null as { day: string; value: number } | null,
      windowDays: 0,
      longestStreak: 0,
      totalTokens: 0
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
      totalTokens: total
    }
  }, [data.heatmap])


  return (
    <div className="fade-in lab3d">
      <div className="panel">
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
            <Landscape cells={cells} weeks={weeks} isDark={isDark} themeKey={themeKey} />
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
  day: string
  weekday: string
  value: number
}

interface SceneProps {
  cells: Cell[]
  weeks: number
  isDark: boolean
  themeKey: string
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


function Landscape({ cells, weeks, isDark, themeKey }: SceneProps) {
  const mount = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    const el = mount.current
    if (!el) return

    const palette = isDark ? PALETTE.dark : PALETTE.light
    const spanX = weeks * UNIT
    const depth = 7 * UNIT

    const scene = new THREE.Scene()
    const width = el.clientWidth || 800
    const height = el.clientHeight || 480

    // Orthographic isometric: parallel edges, no perspective foreshortening.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 8000)
    // Low tilt + slight yaw = the reference's long, gently angled ribbon.
    const dir = new THREE.Vector3(0.55, 0.62, 1).normalize()
    camera.position.copy(dir.multiplyScalar(1000))
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
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
    cells.forEach((c, i) => {
      m4.makeScale(1, LEVEL_H[c.level]!, 1)
      m4.setPosition((c.wi - (weeks - 1) / 2) * UNIT, 0, (c.di - 3) * UNIT)
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, color.set(palette[c.level]!))
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)

    // --- frustum fit --------------------------------------------------------
    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, HEIGHT_MAX]) {
          corners.push(new THREE.Vector3((sx * (spanX + UNIT)) / 2, y, (sz * (depth + UNIT)) / 2))
        }
      }
    }
    fitOrtho(camera, width / height, corners)

    // --- hover tooltip via raycasting --------------------------------------
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let lastHover = -1
    const onPointerMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const id = raycaster.intersectObject(mesh)[0]?.instanceId ?? -1
      const px = e.clientX - r.left + 14
      const py = e.clientY - r.top + 12
      if (id === lastHover) {
        if (id >= 0) setTip((t) => (t ? { ...t, x: px, y: py } : t))
        return
      }
      lastHover = id
      if (id < 0) {
        setTip(null)
        return
      }
      const c = cells[id]!
      setTip({ x: px, y: py, day: c.day, weekday: WEEKDAYS[c.di]!, value: c.value })
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

    let raf = 0
    const tick = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      fitOrtho(camera, w / h, corners)
    })
    ro.observe(el)


    return () => {
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
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
      {tip && (
        <div className="lab3d-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.day}</b> <span className="dim">{tip.weekday}</span>
          <br />
          {tip.value > 0 ? `${fmt(tip.value)} tokens` : '无记录'}
        </div>
      )}
    </div>
  )
}


