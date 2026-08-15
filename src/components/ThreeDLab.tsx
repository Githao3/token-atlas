import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Dashboard } from '@shared/types'
import { fmt, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

/** 53 weeks — the landscape always shows a trailing year, whatever range is picked. */
const DAYS_IN_VIEW = 371
/** Tallest column in world units, relative to the cell size. */
const MAX_H_CELLS = 8
/** Keeps the 53-week axis at a sane world size. */
const TARGET_WIDTH = 92
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Cell {
  /** Column: week index from the Monday of the window's first week. */
  wi: number
  /** Row: 0 = Monday … 6 = Sunday. */
  di: number
  day: string
  value: number
  /** 0..1 height factor. */
  t: number
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
 * Token Landscape — a trailing year of daily token spend as an isometric terrain.
 *   x = week, z = weekday, column height = that day's total tokens
 *
 * Reads `data.heatmap`, which the aggregator already keeps as a trailing 371-day
 * window, so this view is a fixed "last year" and does not follow the range
 * selector at the top of the app.
 *
 * Built directly on three.js rather than echarts-gl: echarts-gl's ViewGL always
 * constructs an EffectCompositor, which parses its post-processing config with
 * `new Function()`. That needs `'unsafe-eval'` in the CSP, which this app
 * deliberately does not grant. three.js compiles shaders through WebGL instead
 * of eval, so the strict `script-src 'self'` policy stays intact.
 */
export function ThreeDLab({ data, themeKey }: Props) {
  const [spin, setSpin] = useState(false)

  const { cells, weeks, maxVal, span, activeDays } = useMemo(() => {
    const year = data.heatmap.slice(-DAYS_IN_VIEW)
    if (year.length === 0) {
      return { cells: [] as Cell[], weeks: 0, maxVal: 0, span: '', activeDays: 0 }
    }

    let mx = 0
    for (const h of year) if (h.total > mx) mx = h.total

    // Anchor on the Monday of the first week so weekday rows line up.
    const first = toDate(year[0]!.day)
    const anchor = new Date(first.getTime() - mondayIndex(first) * DAY_MS)
    const weekOf = (day: string) =>
      Math.floor((toDate(day).getTime() - anchor.getTime()) / (7 * DAY_MS))

    const out: Cell[] = []
    for (const h of year) {
      if (h.total <= 0) continue
      const d = toDate(h.day)
      // sqrt keeps a 5M day visible next to a 146M peak; the exact number is in
      // the tooltip and the colour ramp, the height is for shape.
      out.push({
        wi: weekOf(h.day),
        di: mondayIndex(d),
        day: h.day,
        value: h.total,
        t: Math.sqrt(h.total / mx)
      })
    }
    if (out.length === 0) {
      return { cells: [] as Cell[], weeks: 0, maxVal: 0, span: '', activeDays: 0 }
    }

    // Crop the leading/trailing empty weeks. The window is still a trailing
    // year, but rendering months of untouched grid as a slab looks broken.
    let minWi = Infinity
    let maxWi = -Infinity
    for (const c of out) {
      minWi = Math.min(minWi, c.wi)
      maxWi = Math.max(maxWi, c.wi)
    }
    for (const c of out) c.wi -= minWi

    return {
      cells: out,
      weeks: maxWi - minWi + 1,
      maxVal: mx,
      span: `${out[0]!.day} → ${year[year.length - 1]!.day}`,
      activeDays: out.length
    }
  }, [data.heatmap])


  return (
    <div className="fade-in lab3d">
      <div className="panel">
        <div className="panel-head">
          <h3>Token Landscape</h3>
          <span className="note">最近一年 · {span} · 拖拽旋转 · 滚轮缩放</span>
        </div>
        {cells.length > 0 ? (
          <>
            <Landscape cells={cells} weeks={weeks} spin={spin} themeKey={themeKey} />
            <div className="lab3d-foot">
              <div className="ramp">
                <span>低</span>
                <i />
                <span>
                  高 · 峰值 {fmt(maxVal)} · {activeDays} 个活跃日
                </span>
              </div>
              <button className={'chip' + (spin ? ' on' : '')} onClick={() => setSpin((v) => !v)}>
                {spin ? '⏸ 停止旋转' : '⏵ 自动旋转'}
              </button>
            </div>
          </>
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
 * Sizes an orthographic frustum so the field exactly fills the viewport.
 * Transforms the bounding-box corners into camera space and takes the extents;
 * an orthographic camera can't be "moved back" to fit, the frustum *is* the fit.
 *
 * The frustum is deliberately off-centre: the terrain's midpoint in camera
 * space is not the camera axis, and forcing a symmetric box around the axis
 * wastes roughly half the viewport.
 */
function fitOrtho(
  camera: THREE.OrthographicCamera,
  aspect: number,
  corners: THREE.Vector3[],
  pad = 1.04
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
  // Grow the short side to the viewport aspect so cells stay square.
  if (halfW / halfH < aspect) halfW = halfH * aspect
  else halfH = halfW / aspect
  camera.left = cx - halfW
  camera.right = cx + halfW
  camera.top = cy + halfH
  camera.bottom = cy - halfH
  camera.updateProjectionMatrix()
}

interface SceneProps {
  cells: Cell[]
  weeks: number
  spin: boolean
  themeKey: string
}

interface Tip {
  x: number
  y: number
  day: string
  weekday: string
  value: number
}

function Landscape({ cells, weeks, spin, themeKey }: SceneProps) {
  const mount = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = spin
  }, [spin])

  // Full scene lifecycle. themeKey forces a rebuild so CSS-var colors re-read.
  useEffect(() => {
    const el = mount.current
    if (!el) return

    const cell = Math.min(Math.max(TARGET_WIDTH / Math.max(weeks, 1), 1.3), 4.4)
    const spanX = cell * weeks
    const depth = cell * 7
    const bar = cell * 0.78 // small gap between columns reads as grid seams
    const maxH = cell * MAX_H_CELLS

    const muted = cssVar('--muted') || '#6c7885'
    const base = new THREE.Color(cssVar('--m1') || '#22c39a')
    const lowC = base.clone().multiplyScalar(0.4)

    const scene = new THREE.Scene()
    const width = el.clientWidth || 800
    const height = el.clientHeight || 480

    // Orthographic, not perspective: parallel edges are what make a calendar
    // terrain read as one clean isometric ribbon instead of a receding tunnel.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 8000)
    const target = new THREE.Vector3(0, maxH * 0.12, 0)
    // 45° azimuth turns the long week axis into a diagonal across the frame.
    camera.position.copy(new THREE.Vector3(1, 0.9, 1).normalize().multiplyScalar(600)).add(target)
    camera.lookAt(target)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    // PLACEHOLDER_BUILD

    // --- lights -------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.74))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(spanX, spanX, depth * 3 + 40)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.32)
    fill.position.set(-spanX, spanX * 0.5, -depth * 3)
    scene.add(fill)

    // --- base grid ----------------------------------------------------------
    const long = Math.max(spanX, depth)
    const grid = new THREE.GridHelper(
      long,
      Math.round(long / cell),
      new THREE.Color(muted),
      new THREE.Color(muted)
    )
    grid.scale.set((spanX + cell) / long, 1, (depth + cell) / long)
    const gridMat = grid.material as THREE.Material
    gridMat.opacity = 0.16
    gridMat.transparent = true
    scene.add(grid)

    // --- one solid column per day ------------------------------------------
    // Single InstancedMesh: a full year of active days is one draw call.
    const geom = new THREE.BoxGeometry(bar, 1, bar)
    geom.translate(0, 0.5, 0) // pivot at the base so scale.y grows upward
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.46, metalness: 0.08 })
    const mesh = new THREE.InstancedMesh(geom, mat, cells.length)

    const m4 = new THREE.Matrix4()
    const color = new THREE.Color()
    cells.forEach((c, i) => {
      m4.makeScale(1, Math.max(c.t * maxH, cell * 0.22), 1)
      m4.setPosition((c.wi - (weeks - 1) / 2) * cell, 0, (c.di - 3) * cell)
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, color.copy(lowC).lerp(base, c.t))
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)

    // --- frustum fit --------------------------------------------------------
    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, maxH]) {
          corners.push(new THREE.Vector3((sx * (spanX + cell)) / 2, y, (sz * (depth + cell)) / 2))
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
    controls.target.copy(target)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // Stay above the ground plane so the terrain is never viewed from below.
    controls.maxPolarAngle = Math.PI * 0.49
    controls.autoRotate = spin
    controls.autoRotateSpeed = 0.5
    controls.minZoom = 0.4
    controls.maxZoom = 8
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
          {fmt(tip.value)} tokens
        </div>
      )}
    </div>
  )
}


