import { useEffect, useRef } from 'react'
import type { Dashboard } from '@shared/types'
import { splitValue, splitMoney, money, fmt } from '../lib/format'

interface Props {
  data: Dashboard
}

/**
 * One delegated pointermove for the whole grid instead of a handler per card:
 * eight independent listeners each forcing a layout read would fight ECharts
 * for the compositor. Writes are coalesced into a single rAF.
 */
function useEdgeGlow(grid: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = grid.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let pending: { card: HTMLElement; x: number; y: number } | null = null

    const flush = () => {
      raf = 0
      const p = pending
      if (!p) return
      const r = p.card.getBoundingClientRect()
      const cx = r.width / 2
      const cy = r.height / 2
      const dx = p.x - r.left - cx
      const dy = p.y - r.top - cy
      // 1 / min(halfWidth/|dx|, halfHeight/|dy|) — 0 at the centre, 1 at the edge
      const kx = dx === 0 ? Infinity : cx / Math.abs(dx)
      const ky = dy === 0 ? Infinity : cy / Math.abs(dy)
      const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
      if (deg < 0) deg += 360
      p.card.style.setProperty('--edge-proximity', (edge * 100).toFixed(1))
      p.card.style.setProperty('--cursor-angle', `${deg.toFixed(1)}deg`)
    }

    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.stat')
      if (!card) return
      pending = { card, x: e.clientX, y: e.clientY }
      if (!raf) raf = requestAnimationFrame(flush)
    }

    el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [grid])
}

export function StatCards({ data }: Props) {
  const s = data.stats
  const grid = useRef<HTMLDivElement>(null)
  const total = splitValue(s.totalTokens)
  const cost = splitMoney(s.totalCost)
  const windowDays = { '7d': 7, '30d': 30, '90d': 90, all: data.heatmap.length }[data.range]

  useEdgeGlow(grid)

  return (
    <div className="stats" ref={grid}>

      <Card
        k="Token usage"
        icon="◇"
        value={
          <>
            <span>{total.v}</span>
            <span className="unit">{total.unit}</span>
          </>
        }
        sub={rangeText(data.range)}
      />
      <Card
        k="Est. cost"
        icon="$"
        value={
          <>
            <span className="unit" style={{ marginRight: 1 }}>
              $
            </span>
            <span>{cost.v}</span>
            <span className="unit">{cost.unit}</span>
          </>
        }
        sub="估算值 · 可自定义单价"
        onClick={() => window.tk.editPricing()}
        hint="点击编辑单价表"
      />
      <Card
        k="Cache hit"
        icon="⚡"
        value={
          <>
            <span>{(s.cacheHitRate * 100).toFixed(1)}</span>
            <span className="unit">%</span>
          </>
        }
        sub={`省下约 ${money(data.cache.saved)}`}
      />
      <Card
        k="Sessions"
        icon="⌥"
        value={<span>{s.sessions.toLocaleString()}</span>}
        sub={`${data.adapters.filter((a) => a.available).length} 个数据源`}
      />
      <Card
        k="Messages"
        icon="✎"
        value={<span>{s.messages >= 1e5 ? fmt(s.messages) : s.messages.toLocaleString()}</span>}
        sub="模型请求次数"
      />
      <Card k="Active days" icon="◷" value={<span>{s.activeDays}</span>} sub={`共 ${windowDays} 天中活跃`} />
      <Card k="Current streak" icon="↯" value={<span>{s.currentStreak}</span>} sub="连续活跃天数" />
      <Card
        k="Favorite model"
        icon="✦"
        small
        value={<span>{s.favoriteModel ? s.favoriteModel.model : '—'}</span>}
        sub={s.favoriteModel ? `${(s.favoriteModel.share * 100).toFixed(1)}% share` : ''}
      />
    </div>
  )
}

function rangeText(r: Dashboard['range']): string {
  return { '7d': '过去 7 天', '30d': '过去 30 天', '90d': '过去 90 天', all: '全部时间' }[r]
}

function Card({
  k,
  icon,
  value,
  sub,
  small,
  onClick,
  hint
}: {
  k: string
  icon: string
  value: React.ReactNode
  sub?: string
  small?: boolean
  onClick?: () => void
  hint?: string
}) {
  return (
    <div
      className="stat"
      onClick={onClick}
      title={hint}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="k">
        <span>{icon}</span>
        {k}
      </div>
      <div className={'v' + (small ? ' small' : '')}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
      <span className="edge-light" />

    </div>
  )
}
