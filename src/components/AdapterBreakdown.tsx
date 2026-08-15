import { useMemo, useState } from 'react'
import type { Dashboard } from '@shared/types'
import { fmt, money, topWithOthers } from '../lib/format'

interface Props {
  data: Dashboard
}

type Metric = 'tokens' | 'cost'

/** Same cap as the model list; with four adapters the tail never fills up, but
    the rule holds if more agents are added later. */
const TOP_N = 5

export function AdapterBreakdown({ data }: Props) {
  const [metric, setMetric] = useState<Metric>('tokens')

  const { top, othersValue, othersCount } = useMemo(
    () =>
      topWithOthers(
        data.adapters,
        (a) => (metric === 'cost' ? a.cost : a.total),
        TOP_N
      ),
    [data.adapters, metric]
  )

  const main = (v: number) => (metric === 'cost' ? money(v) : fmt(v))

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>编程工具</h3>
        <div className="head-tools">
          <div className="seg seg-sm" role="group" aria-label="排序指标">
            <button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>
              Tokens
            </button>
            <button aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>
              成本
            </button>
          </div>
          <span className="note">DATA SOURCES</span>
        </div>
      </div>
      <div className="adapter-grid">
        {top.map((a) => (
          <div
            key={a.adapter}
            className="stat"
            style={{ cursor: a.available ? 'pointer' : 'default' }}
            onClick={() => a.available && window.tk.openPath(a.rootPath)}
            title={a.available ? `打开 ${a.rootPath}` : '未找到数据'}
          >
            <div className="k">
              <span style={{ color: a.available ? 'var(--m1)' : 'var(--muted)' }}>
                {a.available ? '●' : '○'}
              </span>
              {a.label}
            </div>
            <div className="v small">
              {a.available ? main(metric === 'cost' ? a.cost : a.total) : '—'}
            </div>
            {a.available && (
              <div className="sub">
                {metric === 'cost' ? `${fmt(a.total)} tokens` : money(a.cost)} · {a.sessions}{' '}
                sessions · {a.messages} messages
              </div>
            )}
            {a.error && (
              <div className="sub" style={{ color: 'var(--m3)' }}>
                {a.error}
              </div>
            )}
          </div>
        ))}
        {othersCount > 0 && (
          <div className="stat">
            <div className="k">
              <span style={{ color: 'var(--muted)' }}>○</span>其他 {othersCount} 个
            </div>
            <div className="v small">{main(othersValue)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
