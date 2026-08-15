import { useMemo, useState } from 'react'
import type { Dashboard } from '@shared/types'
import { EChart } from './EChart'
import { colorForIndex, fmt, cssVar, topWithOthers } from '../lib/format'
import { useI18n } from '../lib/i18n'

interface Props {
  data: Dashboard
  themeKey: string
}

type Metric = 'tokens' | 'calls'

const TOP_N = 5
const OTHERS_COLOR = 'var(--muted)'

/**
 * Per-model trend over the selected range: the top 5 models plus an Others
 * line. Switches between tokens and call count — a model can be a small share
 * of tokens but a large share of calls (many cheap turns) or the reverse.
 */
export function ModelTrend({ data, themeKey }: Props) {
  const { t, lang } = useI18n()
  const [metric, setMetric] = useState<Metric>('tokens')

  const { days, series, othersName } = useMemo(() => {
    const days = data.trend.map((p) => p.day)
    const dayIdx = new Map(days.map((d, i) => [d, i]))
    const val = (p: (typeof data.perDay)[number]) => (metric === 'calls' ? p.turns : p.total)

    // Rank models by their total on the current metric.
    const agg = new Map<string, number>()
    for (const p of data.perDay) agg.set(p.model, (agg.get(p.model) ?? 0) + val(p))
    const ranked = [...agg.entries()].map(([model, value]) => ({ model, value }))
    const { top } = topWithOthers(ranked, (r) => r.value, TOP_N)
    const topModels = top.map((r) => r.model)
    const topSet = new Set(topModels)

    // One 0-filled column per day for each top model, and one for the tail.
    const lines = new Map<string, number[]>()
    for (const m of topModels) lines.set(m, new Array(days.length).fill(0))
    const others = new Array(days.length).fill(0)
    let hasOthers = false
    for (const p of data.perDay) {
      const i = dayIdx.get(p.day)
      if (i === undefined) continue
      if (topSet.has(p.model)) lines.get(p.model)![i] += val(p)
      else {
        others[i] += val(p)
        hasOthers = true
      }
    }

    const series = topModels.map((m, i) => ({
      name: m,
      color: colorForIndex(i),
      data: lines.get(m)!
    }))
    if (hasOthers) series.push({ name: t('common.othersShort'), color: OTHERS_COLOR, data: others })
    return { days, series, othersName: t('common.othersShort') }
  }, [data.perDay, data.trend, metric, t])

  const unit = (v: number) =>
    metric === 'calls' ? t('mt.callsUnit', { n: Math.round(v) }) : `${fmt(v)} tokens`

  const option = useMemo(
    () => ({
      // Kept so metric switches morph rather than jump; the entrance is CSS.
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      tooltip: {
        trigger: 'axis' as const,
        appendToBody: true,
        confine: true,
        backgroundColor: cssVar('--panel-solid'),
        borderColor: cssVar('--panel-brd'),
        textStyle: { color: cssVar('--ink'), fontFamily: 'var(--font-mono)', fontSize: 11 },
        formatter(params: unknown[]) {
          const ps = params as Array<{ seriesName: string; value: number; color: string; axisValue: string }>
          const day = ps[0]?.axisValue ?? ''
          let html = `<b>${day}</b><br>`
          for (const p of [...ps].sort((a, b) => b.value - a.value)) {
            if (p.value > 0)
              html += `<span style="color:${p.color}">●</span> ${p.seriesName}: ${unit(p.value)}<br>`
          }
          return html
        }
      },
      grid: { top: 16, bottom: 30, left: 58, right: 16 },
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
          formatter: (v: number) => (metric === 'calls' ? String(v) : fmt(v))
        },
        splitLine: { lineStyle: { color: cssVar('--line'), type: 'dashed' as const } }
      },
      series: series.map((s) => ({
        name: s.name,
        type: 'line' as const,
        data: s.data,
        showSymbol: false,
        smooth: 0.35,
        smoothMonotone: 'x' as const,
        lineStyle: {
          width: s.name === othersName ? 1.6 : 2.2,
          color: s.color,
          opacity: s.name === othersName ? 0.7 : 1
        },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series' as const }
      }))
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, series, metric, themeKey, t]
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t('mt.title')}</h3>
        <div className="head-tools">
          <div className="seg seg-sm" role="group" aria-label={t('seg.metricAria')}>
            <button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>
              {t('seg.tokens')}
            </button>
            <button aria-pressed={metric === 'calls'} onClick={() => setMetric('calls')}>
              {t('seg.calls')}
            </button>
          </div>
          <span className="note">{t('mt.note', { n: TOP_N })}</span>
        </div>
      </div>
      <EChart option={option} className="chart trend delay" themeKey={themeKey + metric + lang} />
      <div className="chart-legend">
        {series.map((s) => (
          <div key={s.name}>
            <i style={{ background: s.color }} />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
