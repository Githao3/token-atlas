import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Dashboard } from '@shared/types'
import { colorForIndex, fmt, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

/** Top N models get a ridge each; more than this and the terrain turns to mush. */
const MAX_MODELS = 6
/** Tallest bar in world units — everything else scales against the range max. */
const MAX_BAR_H = 9
/** Keep the footprint bounded no matter how many days are in range. */
const TARGET_WIDTH = 58

interface Bar {
  xi: number
  yi: number
  value: number
}

/**
 * Token Landscape — a 3D terrain of daily token spend.
 *   x = day, z = model, height = tokens
 *
 * Built directly on three.js rather than echarts-gl: echarts-gl's ViewGL always
 * constructs an EffectCompositor, which parses its post-processing config with
 * `new Function()`. That needs `'unsafe-eval'` in the CSP, which this app
 * deliberately does not grant. three.js compiles shaders through WebGL instead
 * of eval, so the strict `script-src 'self'` policy stays intact.
 */
export function ThreeDLab({ data, themeKey }: Props) {
  const [autoRotate, setAutoRotate] = useState(true)

  const models = useMemo(() => data.models.slice(0, MAX_MODELS).map((m) => m.model), [data.models])
  const days = useMemo(() => [...new Set(data.perDay.map((d) => d.day))].sort(), [data.perDay])

  const bars = useMemo(() => {
    const idx = new Map(models.map((m, i) => [m, i]))
    const out: Bar[] = []
    const dayIdx = new Map(days.map((d, i) => [d, i]))
    for (const p of data.perDay) {
      const yi = idx.get(p.model)
      const xi = dayIdx.get(p.day)
      if (yi === undefined || xi === undefined || p.total <= 0) continue
      out.push({ xi, yi, value: p.total })
    }
    return out
  }, [data.perDay, models, days])

  const hasData = bars.length > 0

  return (
    <div className="fade-in lab3d">
      <div className="panel">
        <div className="panel-head">
          <h3>Token Landscape</h3>
          <span className="note">{rangeNote(data.range)} · 拖拽旋转 · 滚轮缩放</span>
        </div>
        {hasData ? (
          <>
            <Landscape
              bars={bars}
              days={days}
              models={models}
              autoRotate={autoRotate}
              themeKey={themeKey}
            />
            <div className="lab3d-foot">
              <div className="chart-legend">
                {models.map((m, i) => (
                  <div key={m}>
                    <i style={{ background: colorForIndex(i) }} />
                    <span>{m}</span>
                  </div>
                ))}
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
function makeLabel(text: string, color: string, px = 44): THREE.Sprite {
  const pad = 8
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `500 ${px}px ui-monospace, "JetBrains Mono", Consolas, monospace`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  canvas.width = w
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

interface SceneProps {
  bars: Bar[]
  days: string[]
  models: string[]
  autoRotate: boolean
  themeKey: string
}

interface Tip {
  x: number
  y: number
  day: string
  model: string
  color: string
  value: number
}

function Landscape({ bars, days, models, autoRotate, themeKey }: SceneProps) {
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

    const maxVal = bars.reduce((m, b) => Math.max(m, b.value), 0) || 1
    const nx = days.length
    const nz = models.length
    // Days are packed to a bounded width; model rows get wider spacing so the
    // ridges stay visually separate instead of merging into one wall.
    const cellX = Math.max(TARGET_WIDTH / Math.max(nx, 1), 1.2)
    const cellZ = Math.max(cellX, 2.8)
    const depth = cellZ * Math.max(nz, 1)
    const spanX = cellX * nx
    const barW = cellX * 0.72

    const muted = cssVar('--muted') || '#6c7885'

    const scene = new THREE.Scene()
    const width = el.clientWidth || 800
    const height = el.clientHeight || 480
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 3000)

    // Frame the whole field: pick the distance that fits both the long X span
    // and the bar height, then place the camera along a fixed 3/4 view vector.
    const vFov = THREE.MathUtils.degToRad(45)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (width / height))
    const dist = Math.max(
      (spanX * 0.55) / Math.tan(hFov / 2),
      (MAX_BAR_H * 1.5 + depth * 0.5) / Math.tan(vFov / 2),
      26
    )
    // ~44° elevation: low enough to read bar heights, high enough that the
    // model rows spread out vertically instead of collapsing into one band.
    const dir = new THREE.Vector3(0.34, 0.72, 0.66).normalize()
    camera.position.copy(dir.multiplyScalar(dist))


    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)


    // --- hover tooltip via raycasting --------------------------------------
    // `mesh` is created further down; the handler only runs after setup.
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
      const b = bars[id]!
      setTip({ x: px, y: py, day: days[b.xi]!, model: models[b.yi]!, color: colorForIndex(b.yi), value: b.value })
    }
    const onLeave = () => {
      lastHover = -1
      setTip(null)
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    // --- lights -------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.62))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(spanX * 0.35, MAX_BAR_H * 3, depth * 2 + 20)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(cssVar('--accent') || '#5b8cff'), 0.55)
    rim.position.set(-spanX * 0.5, MAX_BAR_H, -depth * 2)
    scene.add(rim)

    // --- base grid ----------------------------------------------------------
    // GridHelper is square, so size it on the long axis and squash the depth.
    const grid = new THREE.GridHelper(spanX, nx, new THREE.Color(muted), new THREE.Color(muted))
    grid.scale.z = depth / spanX
    const gridMat = grid.material as THREE.Material
    gridMat.opacity = 0.14
    gridMat.transparent = true
    scene.add(grid)

    // --- bars ---------------------------------------------------------------
    // One InstancedMesh for every bar: a 90-day x 6-model range is ~540 boxes,
    // which would be 540 draw calls as separate meshes.
    const geom = new THREE.BoxGeometry(barW, 1, barW)
    geom.translate(0, 0.5, 0) // pivot at the base so scale.y grows upward
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.15 })
    const mesh = new THREE.InstancedMesh(geom, mat, bars.length)

    const m4 = new THREE.Matrix4()
    const color = new THREE.Color()
    bars.forEach((b, i) => {
      const h = Math.max((b.value / maxVal) * MAX_BAR_H, 0.06)
      m4.makeScale(1, h, 1)
      m4.setPosition((b.xi - (nx - 1) / 2) * cellX, 0, (b.yi - (nz - 1) / 2) * cellZ)
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, color.set(colorForIndex(b.yi)))
    })
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)

    // --- date labels --------------------------------------------------------
    // Model names live in the HTML legend below; putting them in the scene too
    // made them pile up on each other at this camera distance.
    const dayMarks = new Set(nx > 2 ? [0, Math.floor((nx - 1) / 2), nx - 1] : [0])
    for (const xi of dayMarks) {
      const s = makeLabel(days[xi]!.slice(5), muted, 34)
      s.position.set((xi - (nx - 1) / 2) * cellX, 0.4, depth / 2 + s.scale.y * 0.8)
      scene.add(s)
    }

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, MAX_BAR_H * 0.22, 0)
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
  }, [bars, days, models, themeKey])

  return (
    <div className="chart-3d" ref={mount}>
      {tip && (
        <div className="lab3d-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.day}</b>
          <br />
          <span style={{ color: tip.color }}>●</span> {tip.model}
          <br />
          {fmt(tip.value)} tokens
        </div>
      )}
    </div>
  )
}



