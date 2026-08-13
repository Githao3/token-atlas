import type { Dashboard } from '@shared/types'
import { splitValue, splitMoney, money, fmt } from '../lib/format'

interface Props {
  data: Dashboard
}

export function StatCards({ data }: Props) {
  const s = data.stats
  const total = splitValue(s.totalTokens)
  const cost = splitMoney(s.totalCost)
  const windowDays = { '7d': 7, '30d': 30, '90d': 90, all: data.heatmap.length }[data.range]

  return (
    <div className="stats">
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
      <div className="glowline" />
    </div>
  )
}
