import { useMemo, useState } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { cssVar, fmt, money } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

type Metric = 'cost' | 'tokens'

/** Trailing window for the moving average, in days. */
const MA_WINDOW = 7

/**
 * `#rrggbb` -> `rgba(r,g,b,a)`. zrender parses hex/rgb/rgba/hsl but not CSS
 * `color-mix()`, so chart colours have to be resolved before they go in.
 */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * Trailing mean over `w` days. Leading points average over however many days
 * exist so far rather than being dropped — a 7-day gap at the start of every
 * range would waste most of a 7d view.
 */
function movingAverage(values: number[], w: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= w) sum -= values[i - w]!
    out.push(sum / Math.min(i + 1, w))
  }
  return out
}

/**
 * Cost (or tokens) per day with a 7-day moving average on top.
 *
 * The daily series alone is close to unreadable: usage is bursty and weekday-
 * shaped, so consecutive days swing by an order of magnitude and any real drift
 * is buried. The moving average is the part that answers "am I trending up".
 *
 * Cost is the default because it is the number that has consequences, and it
 * moves independently of tokens — a day served mostly from cache can be 10x
 * cheaper per token than a day of fresh prompts.
 */
export function CostTrend({ data, themeKey }: Props) {
  const [metric, setMetric] = useState<Metric>('tokens')

  const option = useMemo(() => {
    const days = data.trend.map((p) => p.day)
    const raw = data.trend.map((p) => (metric === 'cost' ? p.cost : p.total))
    const ma = movingAverage(raw, MA_WINDOW)
    const unit = (v: number) => (metric === 'cost' ? money(v) : fmt(v))
    const line = (metric === 'cost' ? cssVar('--m2') : cssVar('--m1')) || '#22c39a'

    return {
      tooltip: {
        trigger: 'axis' as const,
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter(params: unknown[]) {
          const i = (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0
          const p = data.trend[i]
          if (!p) return ''
          return (
            `<b>${p.day}</b><br>` +
            `成本 ${money(p.cost)}<br>` +
            `Tokens ${fmt(p.total)}<br>` +
            `轮次 ${p.turns}<br>` +
            `<span style="opacity:.6">${MA_WINDOW} 日均 ${unit(ma[i] ?? 0)}</span>`
          )
        }
      },
      grid: { top: 22, bottom: 30, left: 58, right: 14 },
      xAxis: {
        type: 'category' as const,
        data: days,
        boundaryGap: false,
        axisLine: { lineStyle: { color: cssVar('--line') } },
        axisLabel: { color: cssVar('--muted'), fontSize: 10, fontFamily: 'var(--font-mono)' }
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: cssVar('--muted'),
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          formatter: unit
        },
        splitLine: { lineStyle: { color: cssVar('--line'), type: 'dashed' as const } }
      },
      series: [
        {
          name: '每日',
          type: 'line' as const,
          data: raw,
          showSymbol: false,
          smooth: 0.35,
          /* Monotone in x stops the spline from overshooting below zero between
             a spike and a silent day — a curve dipping under the axis would
             imply negative usage. */
          smoothMonotone: 'x' as const,
          lineStyle: { width: 1.4, color: line, opacity: 0.55 },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(line, 0.28) },
                { offset: 1, color: withAlpha(line, 0) }
              ]
            }
          }
        },
        {
          name: `${MA_WINDOW} 日均`,
          type: 'line' as const,
          data: ma,
          showSymbol: false,
          smooth: true,
          smoothMonotone: 'x' as const,
          lineStyle: { width: 2.6, color: line }
        }
      ]
    }
  }, [data, metric, themeKey])

  const total = data.trend.reduce((s, p) => s + (metric === 'cost' ? p.cost : p.total), 0)
  const peak = data.trend.reduce(
    (best, p) => {
      const v = metric === 'cost' ? p.cost : p.total
      return v > best.v ? { v, day: p.day } : best
    },
    { v: 0, day: '' }
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{metric === 'cost' ? '成本趋势' : 'Token 趋势'}</h3>
        <div className="seg seg-sm" role="group" aria-label="趋势指标">
          <button type="button" aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>
            成本
          </button>
          <button
            type="button"
            aria-pressed={metric === 'tokens'}
            onClick={() => setMetric('tokens')}
          >
            Tokens
          </button>
        </div>
      </div>
      <EChart option={option} className="chart trend" themeKey={themeKey + metric} />
      <div className="chart-foot">
        <span>
          区间合计 <b>{metric === 'cost' ? money(total) : fmt(total)}</b>
        </span>
        <span>
          峰值 <b>{metric === 'cost' ? money(peak.v) : fmt(peak.v)}</b>
          {peak.day && <span className="dim"> · {peak.day}</span>}
        </span>
        <span className="dim">粗线为 {MA_WINDOW} 日移动平均</span>
      </div>
    </div>
  )
}
