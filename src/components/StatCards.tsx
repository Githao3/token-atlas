import { useEffect, useRef } from 'react'
import type { Dashboard } from '@shared/types'
import { splitValue, splitMoney, money, fmt } from '../lib/format'
import { useI18n } from '../lib/i18n'

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
  const { t } = useI18n()
  const s = data.stats
  const grid = useRef<HTMLDivElement>(null)
  const total = splitValue(s.totalTokens)
  const cost = splitMoney(s.totalCost)
  const windowDays = { '7d': 7, '30d': 30, '90d': 90, all: data.heatmap.length }[data.range]

  useEdgeGlow(grid)

  return (
    <div className="stats" ref={grid}>

      <Card
        k={t('card.tokenUsage')}
        icon="◇"
        value={
          <>
            <span>{total.v}</span>
            <span className="unit">{total.unit}</span>
          </>
        }
        sub={t(`range.past.${data.range}`)}
      />
      <Card
        k={t('card.estCost')}
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
        sub={t('card.estSub')}
        onClick={() => window.tk.editPricing()}
        hint={t('card.estHint')}
      />
      <Card
        k={t('card.cacheHit')}
        icon="⚡"
        value={
          <>
            <span>{(s.cacheHitRate * 100).toFixed(1)}</span>
            <span className="unit">%</span>
          </>
        }
        sub={t('card.saved', { v: money(data.cache.saved) })}
      />
      <Card
        k={t('card.sessions')}
        icon="⌥"
        value={<span>{s.sessions.toLocaleString()}</span>}
        sub={t('top.sources', { n: data.adapters.filter((a) => a.available).length })}
      />
      <Card
        k={t('card.messages')}
        icon="✎"
        value={<span>{s.messages >= 1e5 ? fmt(s.messages) : s.messages.toLocaleString()}</span>}
        sub={t('card.msgSub')}
      />
      <Card
        k={t('card.activeDays')}
        icon="◷"
        value={<span>{s.activeDays}</span>}
        sub={t('card.activeSub', { n: windowDays })}
      />
      <Card
        k={t('card.streak')}
        icon="↯"
        value={<span>{s.currentStreak}</span>}
        sub={t('card.streakSub')}
      />
      <Card
        k={t('card.favModel')}
        icon="✦"
        small
        value={<span>{s.favoriteModel ? s.favoriteModel.model : '—'}</span>}
        sub={
          s.favoriteModel
            ? t('card.share', { v: (s.favoriteModel.share * 100).toFixed(1) })
            : ''
        }
      />
    </div>
  )
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
