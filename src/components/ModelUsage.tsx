import { useMemo, useState } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { colorForIndex, fmt, money, splitValue, splitMoney, cssVar, topWithOthers } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

type Metric = 'tokens' | 'cost'

/** Rows past this are collapsed into a single "Others" slice. */
const TOP_N = 5
/** A neutral grey for the Others bucket, so it never competes with a real model. */
const OTHERS_COLOR = 'var(--muted)'

interface Row {
  name: string
  value: number
  color: string
  isOthers: boolean
}

export function ModelUsage({ data, themeKey }: Props) {
  const [metric, setMetric] = useState<Metric>('tokens')

  const { rows, grand } = useMemo(() => {
    const value = (m: (typeof data.models)[number]) => (metric === 'cost' ? m.cost : m.total)
    const { top, othersValue, othersCount, grand } = topWithOthers(data.models, value, TOP_N)
    const out: Row[] = top.map((m, i) => ({
      name: m.model,
      value: value(m),
      color: colorForIndex(i),
      isOthers: false
    }))
    if (othersCount > 0) {
      out.push({
        name: `其他 ${othersCount} 个`,
        value: othersValue,
        color: OTHERS_COLOR,
        isOthers: true
      })
    }
    return { rows: out, grand }
  }, [data.models, metric])

  const fmtVal = (v: number) => (metric === 'cost' ? money(v) : `${fmt(v)} tokens`)
  const center = metric === 'cost' ? splitMoney(grand) : splitValue(grand)

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item' as const,
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter(params: { name: string; value: number; percent: number }) {
          return `${params.name}<br/>${fmtVal(params.value)} (${params.percent}%)`
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
          data: rows.map((r) => ({
            value: r.value,
            name: r.name,
            itemStyle: {
              color: r.isOthers ? cssVar('--muted') : r.color,
              borderColor: cssVar('--panel-solid'),
              borderWidth: 2
            }
          }))
        }
      ]
    }),
    // fmtVal closes over metric; themeKey re-reads CSS vars
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, metric, themeKey]
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Model usage</h3>
        <div className="head-tools">
          <div className="seg seg-sm" role="group" aria-label="排序指标">
            <button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>
              Tokens
            </button>
            <button aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>
              成本
            </button>
          </div>
          <span className="note">{data.models.length} models</span>
        </div>
      </div>
      <div className="model-split">
        <div className="donut-wrap">
          <EChart option={option} className="chart donut" themeKey={themeKey + metric} />
          <div className="donut-center">
            <span>
              <span className="big">
                {center.v}
                <span className="unit">{center.unit}</span>
              </span>
              <span className="cap">{metric === 'cost' ? 'USD' : 'TOKENS'}</span>
            </span>
          </div>
        </div>
        <div className="mlist">
          {rows.map((r) => (
            <div className="mrow" key={r.name}>
              <span className="swatch" style={{ background: r.color }} />
              <span className={'name' + (r.isOthers ? ' dim' : '')}>{r.name}</span>
              <span className="pct">{grand > 0 ? ((r.value / grand) * 100).toFixed(1) : '0.0'}%</span>
              <span className="amt">{fmtVal(r.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
