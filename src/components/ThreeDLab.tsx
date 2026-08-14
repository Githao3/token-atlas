import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Dashboard } from '@shared/types'
import { fmt, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

/** Tallest stack, in unit cubes. Everything scales against the range peak. */
const MAX_UNITS = 8
/** Keeps the week axis bounded whether the range is 7 days or a full year. */
const TARGET_WIDTH = 84
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Cell {
  /** Column: week index from the Monday of the first week in range. */
  wi: number
  /** Row: 0 = Monday … 6 = Sunday. */
  di: number
  day: string
  value: number
  /** Height in stacked unit cubes, at least 1 so active days stay visible. */
  units: number
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
 * Token Landscape — daily token spend as an isometric voxel calendar.
 *   x = week, z = weekday, stack height = that day's total tokens
 *
 * Deliberately has no model dimension: one column per day keeps it readable,
 * and the per-model split already has its own panel on the Overview tab.
 *
 * Built directly on three.js rather than echarts-gl: echarts-gl's ViewGL always
 * constructs an EffectCompositor, which parses its post-processing config with
 * `new Function()`. That needs `'unsafe-eval'` in the CSP, which this app
 * deliberately does not grant. three.js compiles shaders through WebGL instead
 * of eval, so the strict `script-src 'self'` policy stays intact.
 */
export function ThreeDLab({ data, themeKey }: Props) {
  const [spin, setSpin] = useState(false)

  const { cells, weeks, maxVal } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const p of data.perDay) {
      totals.set(p.day, (totals.get(p.day) ?? 0) + p.total)
    }
    const days = [...totals.keys()].sort()
    if (days.length === 0) return { cells: [] as Cell[], weeks: 0, maxVal: 0 }

    let mx = 0
    for (const v of totals.values()) if (v > mx) mx = v

    // Anchor the grid on the Monday of the first week so columns line up.
    const first = toDate(days[0]!)
    const anchor = new Date(first.getTime() - mondayIndex(first) * DAY_MS)

    let wk = 0
    const out: Cell[] = []
    for (const day of days) {
      const value = totals.get(day)!
      if (value <= 0) continue
      const d = toDate(day)
      const wi = Math.floor((d.getTime() - anchor.getTime()) / (7 * DAY_MS))
      out.push({
        wi,
        di: mondayIndex(d),
        day,
        value,
        units: Math.max(1, Math.ceil((value / mx) * MAX_UNITS))
      })
      if (wi > wk) wk = wi
    }
    return { cells: out, weeks: wk + 1, maxVal: mx }
  }, [data.perDay])

  const span = useMemo(() => {
    if (cells.length === 0) return ''
    return `${cells[0]!.day} → ${cells[cells.length - 1]!.day}`
  }, [cells])

  return (
    <div className="fade-in lab3d">
      <div className="panel">
        <div className="panel-head">
          <h3>Token Landscape</h3>
          <span className="note">{span || rangeNote(data.range)} · 拖拽旋转 · 滚轮缩放</span>
        </div>

        {cells.length > 0 ? (
          <>
            <Landscape cells={cells} weeks={weeks} spin={spin} themeKey={themeKey} />
            <div className="lab3d-foot">
              <div className="ramp">
                <span>低</span>
                <i />
                <span>高 · 峰值 {fmt(maxVal)}</span>
              </div>
              <button className={'chip' + (spin ? ' on' : '')} onClick={() => setSpin((v) => !v)}>
                {spin ? '⏸ 停止旋转' : '⏵ 自动旋转'}
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
  // Grow the short side to the viewport aspect so cubes stay square.
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

    const cell = Math.min(Math.max(TARGET_WIDTH / Math.max(weeks, 1), 1.6), 4.4)
    const spanX = cell * weeks
    const depth = cell * 7
    const cube = cell * 0.82 // small gap between columns reads as grid seams
    const unit = cell * 0.78 // near-cubic voxels, like the reference render

    const muted = cssVar('--muted') || '#6c7885'
    const base = new THREE.Color(cssVar('--m1') || '#22c39a')
    const lowC = base.clone().multiplyScalar(0.42)

    const scene = new THREE.Scene()
    const width = el.clientWidth || 800
    const height = el.clientHeight || 480

    // Orthographic, not perspective: parallel edges are what makes a voxel
    // calendar read as one clean isometric ribbon instead of a receding tunnel.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000)
    const target = new THREE.Vector3(0, unit * 1.2, 0)
    // 45° azimuth turns the long week axis into a diagonal across the frame.
    camera.position.copy(new THREE.Vector3(1, 0.92, 1).normalize().multiplyScalar(400)).add(target)
    camera.lookAt(target)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    // PLACEHOLDER_BUILD

    // --- lights -------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.72))
    const key = new THREE.DirectionalLight(0xffffff, 1.25)
    key.position.set(spanX, spanX + 60, depth * 2 + 40)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-spanX, spanX * 0.4, -depth * 2)
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

    // --- voxel stacks -------------------------------------------------------
    // Every unit cube is one instance of a single box, so the whole terrain is
    // one draw call. `owner` maps an instanceId back to the day it belongs to.
    const totalUnits = cells.reduce((n, c) => n + c.units, 0)
    const geom = new THREE.BoxGeometry(cube, unit * 0.9, cube)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.08 })
    const mesh = new THREE.InstancedMesh(geom, mat, totalUnits)
    const owner = new Int32Array(totalUnits)

    const m4 = new THREE.Matrix4()
    const color = new THREE.Color()
    let n = 0
    cells.forEach((c, ci) => {
      const x = (c.wi - (weeks - 1) / 2) * cell
      const z = (c.di - 3) * cell
      for (let k = 0; k < c.units; k++) {
        // Shade by the cube's own height, so tall stacks brighten as they rise.
        const t = c.units === 1 ? 0.5 : k / (MAX_UNITS - 1)
        m4.makeTranslation(x, (k + 0.5) * unit, z)
        mesh.setMatrixAt(n, m4)
        mesh.setColorAt(n, color.copy(lowC).lerp(base, Math.min(0.25 + t * 1.15, 1)))
        owner[n] = ci
        n++
      }
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)

    // --- frustum fit --------------------------------------------------------

    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, unit * MAX_UNITS]) {
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
      const inst = raycaster.intersectObject(mesh)[0]?.instanceId
      const ci = inst === undefined ? -1 : owner[inst]!
      const px = e.clientX - r.left + 14
      const py = e.clientY - r.top + 12
      if (ci === lastHover) {
        if (ci >= 0) setTip((t) => (t ? { ...t, x: px, y: py } : t))
        return
      }
      lastHover = ci
      if (ci < 0) {
        setTip(null)
        return
      }
      const c = cells[ci]!
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
    controls.maxZoom = 6
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
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose()
          o.material.dispose()
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


