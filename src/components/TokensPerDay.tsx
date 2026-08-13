import { useMemo } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { colorForIndex, fmt, cssVar } from '../lib/format'

interface Props {
  data: Dashboard
  themeKey: string
}

export function TokensPerDay({ data, themeKey }: Props) {
  const daySpan = useMemo(() => {
    if (data.perDay.length === 0) return '—'
    const days = data.perDay.map((p) => p.day)
    return `${days[0]} → ${days[days.length - 1]}`
  }, [data.perDay])

  /** Models actually present in this range, in stacking order — drives the legend. */
  const stacked = useMemo(() => data.models.slice(0, 8).map((m) => m.model), [data.models])

  const option = useMemo(() => {
    // Group per-day entries by model.
    const daySet = [...new Set(data.perDay.map((d) => d.day))].sort()
    const series = stacked.map((model, i) => {
      const dmap = new Map(data.perDay.filter((p) => p.model === model).map((p) => [p.day, p.total]))
      return {
        name: model,
        type: 'bar' as const,
        stack: 'total',
        data: daySet.map((d) => dmap.get(d) ?? 0),
        itemStyle: { color: colorForIndex(i), borderRadius: [2, 2, 0, 0] },
        emphasis: { focus: 'series' as const }
      }
    })
    return {
      tooltip: {
        trigger: 'axis' as const,
        // Escape the panel's `overflow:hidden` and keep the box inside the viewport.
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter(params: unknown[]) {
          const ps = params as Array<{ seriesName: string; value: number; color: string }>
          const day = (params as Array<{ axisValue: string }>)[0]?.axisValue ?? ''
          let html = `<b>${day}</b><br>`
          let total = 0
          for (const p of ps) {
            if (p.value > 0) {
              html += `<span style="color:${p.color}">●</span> ${p.seriesName}: ${fmt(p.value)}<br>`
              total += p.value
            }
          }
          html += `<br>Total: ${fmt(total)}`
          return html
        }
      },
      legend: { show: false },
      grid: { top: 22, bottom: 30, left: 54, right: 14 },
      xAxis: {
        type: 'category' as const,
        data: daySet,
        axisLine: { lineStyle: { color: cssVar('--line') } },
        axisLabel: { color: cssVar('--muted'), fontSize: 10, fontFamily: 'var(--font-mono)' }
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: cssVar('--muted'),
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          formatter: (v: number) => fmt(v)
        },
        splitLine: { lineStyle: { color: cssVar('--line'), type: 'dashed' as const } }
      },
      series
    }
  }, [data, stacked, themeKey])

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Tokens per day</h3>
        <span className="note">{daySpan}</span>
      </div>
      <EChart option={option} className="chart tall" themeKey={themeKey} />
      <div className="chart-legend">
        {stacked.map((model, i) => (
          <div key={model}>
            <i style={{ background: colorForIndex(i) }} />
            <span>{model}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
