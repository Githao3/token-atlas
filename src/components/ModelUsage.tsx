import { useMemo } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { colorForIndex, fmt, splitValue, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

export function ModelUsage({ data, themeKey }: Props) {
  const models = data.models.slice(0, 10)
  const total = splitValue(data.stats.totalTokens)

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item' as const,
        // Render on <body> so the panel's `overflow:hidden` can't clip it, and
        // confine to the viewport so it never spills off-screen.
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter(params: { name: string; value: number; percent: number }) {
          return `${params.name}<br/>${fmt(params.value)} tokens (${params.percent}%)`
        }
      },
      series: [
        {
          type: 'pie' as const,
          radius: ['58%', '86%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          emphasis: { label: { show: false }, scale: true, scaleSize: 6 },
          data: models.map((m, i) => ({
            value: m.total,
            name: m.model,
            itemStyle: { color: colorForIndex(i), borderColor: cssVar('--panel-solid'), borderWidth: 2 }
          }))
        }
      ]
    }),
    [models, themeKey]
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Model usage</h3>
        <span className="note">{data.models.length} models</span>
      </div>
      <div className="model-split">
        <div className="donut-wrap">
          <EChart option={option} className="chart donut" themeKey={themeKey} />
          <div className="donut-center">
            <span>
              <span className="big">
                {total.v}
                <span className="unit">{total.unit}</span>
              </span>
              <span className="cap">TOKENS</span>
            </span>
          </div>
        </div>
        <div className="mlist">
          {models.map((m, i) => (
            <div className="mrow" key={m.model}>
              <span className="swatch" style={{ background: colorForIndex(i) }} />
              <span className="name">{m.model}</span>
              <span className="pct">{(m.share * 100).toFixed(1)}%</span>
              <span className="amt">{fmt(m.total)} tokens</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
