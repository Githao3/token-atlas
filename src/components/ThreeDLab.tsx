import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Dashboard } from '@shared/types'
import { fmt, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

/** Tallest bar in world units — everything else scales against the range max. */
const MAX_BAR_H = 9
/** Keeps the week axis bounded whether the range is 7 days or a full year. */
const TARGET_WIDTH = 70
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Cell {
  /** Column: week index from the Monday of the first week in range. */
  wi: number
  /** Row: 0 = Monday … 6 = Sunday. */
  di: number
  day: string
  value: number
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

/**
 * Token Landscape — daily token spend as a 3D calendar terrain.
 *   x = week, z = weekday, height = that day's total tokens
 *
 * Deliberately has no model dimension: one bar per day keeps it readable, and
 * the per-model split already has its own panel on the Overview tab.
 *
 * Built directly on three.js rather than echarts-gl: echarts-gl's ViewGL always
 * constructs an EffectCompositor, which parses its post-processing config with
 * `new Function()`. That needs `'unsafe-eval'` in the CSP, which this app
 * deliberately does not grant. three.js compiles shaders through WebGL instead
 * of eval, so the strict `script-src 'self'` policy stays intact.
 */
export function ThreeDLab({ data, themeKey }: Props) {
  // Off by default: the camera is framed tightly for the resting orientation,
  // and a spinning long range would swing out of frame.
  const [autoRotate, setAutoRotate] = useState(false)


  const { cells, weeks, maxVal } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const p of data.perDay) {
      totals.set(p.day, (totals.get(p.day) ?? 0) + p.total)
    }
    const days = [...totals.keys()].sort()
    if (days.length === 0) return { cells: [] as Cell[], weeks: 0, maxVal: 0 }

    // Anchor the grid on the Monday of the first week so columns line up.
    const first = toDate(days[0]!)
    const anchor = new Date(first.getTime() - mondayIndex(first) * DAY_MS)

    let mx = 0
    let wk = 0
    const out: Cell[] = []
    for (const day of days) {
      const d = toDate(day)
      const wi = Math.floor((d.getTime() - anchor.getTime()) / (7 * DAY_MS))
      const value = totals.get(day)!
      if (value <= 0) continue
      out.push({ wi, di: mondayIndex(d), day, value })
      if (value > mx) mx = value
      if (wi > wk) wk = wi
    }
    return { cells: out, weeks: wk + 1, maxVal: mx }
  }, [data.perDay])

  return (
    <div className="fade-in lab3d">
      <div className="panel">
        <div className="panel-head">
          <h3>Token Landscape</h3>
          <span className="note">{rangeNote(data.range)} · 拖拽旋转 · 滚轮缩放</span>
        </div>
        {cells.length > 0 ? (
          <>
            <Landscape
              cells={cells}
              weeks={weeks}
              maxVal={maxVal}
              autoRotate={autoRotate}
              themeKey={themeKey}
            />
            <div className="lab3d-foot">
              <div className="ramp">
                <span>低</span>
                <i />
                <span>高 · 峰值 {fmt(maxVal)}</span>
              </div>
              <button
                className={'chip' + (autoRotate ? ' on' : '')}
                onClick={() => setAutoRotate((v) => !v)}
              >
                {autoRotate ? '⏸ 停止旋转' : '⏵ 自动旋转'}
              </button>
            </div>
          </>
        ) : (
          <div className="center-state" style={{ minHeight: 320 }}>
            <p>当前范围内没有可用数据。</p>
          </div>
        )}
      </div>
    </div>
  )
}

function rangeNote(r: Dashboard['range']): string {
  return { '7d': '过去 7 天', '30d': '过去 30 天', '90d': '过去 90 天', all: '全部时间' }[r]
}

/** Draws `text` into a canvas texture so it can float in the scene as a sprite. */
function makeLabel(text: string, color: string, px = 34): THREE.Sprite {
  const pad = 8
  const probe = document.createElement('canvas').getContext('2d')!
  const font = `500 ${px}px ui-monospace, "JetBrains Mono", Consolas, monospace`
  probe.font = font
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(probe.measureText(text).width) + pad * 2
  canvas.height = px + pad * 2
  const c = canvas.getContext('2d')!
  c.font = font
  c.fillStyle = color
  c.textBaseline = 'middle'
  c.fillText(text, pad, canvas.height / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  )
  // 1 world unit per 26 canvas px keeps labels legible without dwarfing the bars
  sprite.scale.set(canvas.width / 26, canvas.height / 26, 1)
  return sprite
}

/**
 * Distance at which the whole field fits the viewport. Projects the field's
 * bounding-box corners and scales the distance until the widest one lands at
 * `fill` of the clip box. Analytic formulas get this wrong for long thin
 * fields, because the week axis projects mostly horizontally while the weekday
 * axis and the bar heights project vertically.
 *
 * Fitted for the resting orientation only. Auto-rotate is opt-in and can swing
 * a long range slightly out of frame — filling the frame by default matters
 * more than guaranteeing a 360° orbit never clips.
 */
function fitDistance(
  camera: THREE.PerspectiveCamera,
  dir: THREE.Vector3,
  target: THREE.Vector3,
  halfX: number,
  halfZ: number,
  topY: number,
  fill = 0.9
): number {
  const pts: THREE.Vector3[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0, topY]) {
        pts.push(new THREE.Vector3(sx * halfX, y, sz * halfZ))
      }
    }
  }
  let d = Math.max(halfX, halfZ, topY) * 3
  for (let i = 0; i < 5; i++) {
    camera.position.copy(dir).multiplyScalar(d).add(target)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    let m = 0
    for (const p of pts) {
      const q = p.clone().project(camera)
      m = Math.max(m, Math.abs(q.x), Math.abs(q.y))
    }
    if (m <= 0) break
    d *= m / fill
  }
  return d
}


interface SceneProps {

  cells: Cell[]
  weeks: number
  maxVal: number
  autoRotate: boolean
  themeKey: string
}

interface Tip {
  x: number
  y: number
  day: string
  weekday: string
  value: number
}

function Landscape({ cells, weeks, maxVal, autoRotate, themeKey }: SceneProps) {
  const mount = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  // Auto-rotate flips without tearing down the scene.
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate
  }, [autoRotate])

  // Full scene lifecycle. themeKey forces a rebuild so CSS-var colors re-read.
  useEffect(() => {
    const el = mount.current
    if (!el) return

    const cell = Math.min(Math.max(TARGET_WIDTH / Math.max(weeks, 1), 1.4), 4.2)
    const spanX = cell * weeks
    const depth = cell * 7
    const barW = cell * 0.74

    const muted = cssVar('--muted') || '#6c7885'
    const low = new THREE.Color(cssVar('--m5') || '#16c0d8')
    const high = new THREE.Color(cssVar('--m2') || '#b07cff')

    const scene = new THREE.Scene()
    const width = el.clientWidth || 800
    const height = el.clientHeight || 480
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 3000)

    // ~44° elevation: low enough to read bar heights, high enough to see the grid.
    const dir = new THREE.Vector3(0.34, 0.72, 0.66).normalize()
    const target = new THREE.Vector3(0, MAX_BAR_H * 0.22, 0)
    const dist = fitDistance(camera, dir, target, spanX / 2, depth / 2, MAX_BAR_H)


    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    // PLACEHOLDER_BUILD

    // --- lights -------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.62))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(spanX * 0.35, MAX_BAR_H * 3, depth * 2 + 20)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(cssVar('--accent') || '#5b8cff'), 0.55)
    rim.position.set(-spanX * 0.5, MAX_BAR_H, -depth * 2)
    scene.add(rim)

    // --- base grid ----------------------------------------------------------
    // GridHelper is square, so size it on the long axis and squash the other.
    const long = Math.max(spanX, depth)
    const grid = new THREE.GridHelper(
      long,
      Math.round(long / cell),
      new THREE.Color(muted),
      new THREE.Color(muted)
    )
    grid.scale.set(spanX / long, 1, depth / long)
    const gridMat = grid.material as THREE.Material
    gridMat.opacity = 0.14
    gridMat.transparent = true
    scene.add(grid)

    // --- bars ---------------------------------------------------------------
    // One InstancedMesh for every day: a full year is ~370 boxes, which would
    // otherwise be 370 draw calls.
    const geom = new THREE.BoxGeometry(barW, 1, barW)
    geom.translate(0, 0.5, 0) // pivot at the base so scale.y grows upward
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.15 })
    const mesh = new THREE.InstancedMesh(geom, mat, cells.length)

    const m4 = new THREE.Matrix4()
    const color = new THREE.Color()
    cells.forEach((c, i) => {
      const t = maxVal > 0 ? c.value / maxVal : 0
      m4.makeScale(1, Math.max(t * MAX_BAR_H, 0.08), 1)
      m4.setPosition((c.wi - (weeks - 1) / 2) * cell, 0, (c.di - 3) * cell)
      mesh.setMatrixAt(i, m4)
      // sqrt spreads the ramp: most days sit far below the peak
      mesh.setColorAt(i, color.copy(low).lerp(high, Math.sqrt(t)))
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)

    // --- labels -------------------------------------------------------------
    // Three weekday markers instead of all seven: at tight cell sizes the
    // sprites would overlap each other.
    for (const di of [0, 3, 6]) {
      const s = makeLabel(WEEKDAYS[di]!, muted, 30)
      s.position.set(-spanX / 2 - s.scale.x / 2 - 0.6, 0.4, (di - 3) * cell)
      scene.add(s)
    }
    // One label per month, thinned out when the range spans a whole year.
    const step = weeks > 30 ? 2 : 1
    const seen = new Set<string>()
    for (const c of cells) {
      const month = c.day.slice(0, 7)
      if (seen.has(month)) continue
      seen.add(month)
      if ((seen.size - 1) % step !== 0) continue
      const s = makeLabel(c.day.slice(0, 7), muted, 30)
      s.position.set((c.wi - (weeks - 1) / 2) * cell, 0.4, depth / 2 + s.scale.y * 0.8)
      scene.add(s)
    }

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
    controls.target.copy(target)

    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 14
    controls.maxDistance = dist * 3
    // Stay above the ground plane so the terrain is never viewed from below.
    controls.maxPolarAngle = Math.PI * 0.48
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = 0.55
    controlsRef.current = controls

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
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
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
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose()
          o.material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, weeks, maxVal, themeKey])

  return (
    <div className="chart-3d" ref={mount}>
      {tip && (
        <div className="lab3d-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.day}</b> <span className="dim">{tip.weekday}</span>
          <br />
          {fmt(tip.value)} tokens
        </div>
      )}
    </div>
  )
}


